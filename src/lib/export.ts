import { renderFrame } from './renderer'
import { playRange, useProject } from '../store/useProject'
import { playbackClock } from './playbackClock'
import { ASPECT_SIZES, type ClipId } from './types'

/**
 * 匯出(MVP 版):canvas.captureStream() + MediaRecorder。
 *
 * 這是「即時錄製」—— 3 分鐘的影片就要錄 3 分鐘,而且編碼參數幾乎不能控制。
 * 換成 WebCodecs(mp4box.js demux → VideoDecoder → canvas → VideoEncoder → mp4-muxer)
 * 可以離線快轉編碼,實測快好幾倍,那是第二版要做的事。
 *
 * 先用這條路的理由:整條資料流(取幀 → 合成 → 編碼 → 封裝)先跑通,
 * 之後抽換的只有編碼那一段,renderFrame() 完全不用動。
 */

export interface ExportOptions {
  videos: Record<ClipId, HTMLVideoElement | null>
  /** 相對於 1920x1080 的輸出縮放,0.5 → 960x540 */
  scale?: number
  fps?: number
  onProgress?: (ratio: number) => void
  signal?: AbortSignal
}

export interface ExportResult {
  blob: Blob
  extension: string
}

const MIME_CANDIDATES = [
  { type: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
  { type: 'video/mp4', ext: 'mp4' },
  { type: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { type: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { type: 'video/webm', ext: 'webm' },
]

function pickMime() {
  for (const c of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(c.type)) return c
  }
  throw new Error('這個瀏覽器不支援 MediaRecorder 錄影')
}

type CapturableVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream
  mozCaptureStream?: () => MediaStream
}

/**
 * createMediaElementSource 對同一個 element 只能呼叫一次,再呼叫會 throw。
 * 而且一旦建立,該 element 的聲音就改走 Web Audio,必須自己接回喇叭。
 * 所以這裡快取住,整個 session 共用。
 */
const webAudioTaps = new WeakMap<HTMLMediaElement, MediaStreamAudioDestinationNode>()

/**
 * Safari 沒有實作 HTMLMediaElement.captureStream(),只有 canvas 版本。
 * 不處理的話 iPhone 匯出會靜音 —— 而手機正是主要使用場景。
 * 這裡退回 Web Audio:MediaElementSource → MediaStreamDestination 一樣拿得到音軌。
 */
function tapAudioViaWebAudio(el: HTMLMediaElement): MediaStreamTrack | null {
  try {
    let dest = webAudioTaps.get(el)
    if (!dest) {
      const ac = new AudioContext()
      const source = ac.createMediaElementSource(el)
      dest = ac.createMediaStreamDestination()
      source.connect(dest)
      source.connect(ac.destination) // 接回喇叭,否則錄製時聽不到聲音
      webAudioTaps.set(el, dest)
    }
    return dest.stream.getAudioTracks()[0] ?? null
  } catch {
    return null
  }
}

/** 從主音源那段影片抓音軌。抓不到就輸出無聲,不讓整個匯出失敗。 */
function grabAudioTrack(videos: Record<ClipId, HTMLVideoElement | null>) {
  const { clips } = useProject.getState()
  const order: ClipId[] = ['a', 'b']
  const loudest = order
    .filter((id) => clips[id] && videos[id])
    .sort((x, y) => (clips[y]!.volume ?? 0) - (clips[x]!.volume ?? 0))[0]
  if (!loudest || (clips[loudest]?.volume ?? 0) <= 0) return null

  const el = videos[loudest] as CapturableVideo | null
  if (!el) return null

  const capture = el.captureStream ?? el.mozCaptureStream
  if (capture) {
    try {
      const track = capture.call(el).getAudioTracks()[0]
      if (track) return { track, stopWithTrack: true }
    } catch {
      // 落到 Web Audio
    }
  }
  const track = tapAudioViaWebAudio(el)
  // Web Audio 的音軌是快取共用的,停掉之後就再也拿不到聲音了,所以不能 stop
  return track ? { track, stopWithTrack: false } : null
}

export async function exportComposite(opts: ExportOptions): Promise<ExportResult> {
  const { videos, scale = 1, fps = 30, onProgress, signal } = opts
  const store = useProject.getState()
  if (store.durationMs <= 0) throw new Error('沒有可匯出的內容')
  const range = playRange(store)
  if (range.durationMs <= 0) throw new Error('輸出範圍是空的')

  const size = ASPECT_SIZES[store.aspect]
  const canvas = document.createElement('canvas')
  // 編碼器普遍要求偶數尺寸,奇數會被拒或悄悄裁掉一列
  canvas.width = makeEven(size.w * scale)
  canvas.height = makeEven(size.h * scale)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('無法建立 canvas context')

  const stream = canvas.captureStream(fps)
  const audio = grabAudioTrack(videos)
  if (audio) stream.addTrack(audio.track)

  const mime = pickMime()
  const recorder = new MediaRecorder(stream, {
    mimeType: mime.type,
    videoBitsPerSecond: 8_000_000,
  })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime.type }))
    recorder.onerror = () => reject(new Error('錄製失敗'))
  })

  // 記下原本的播放狀態,匯出完要還原
  const restore = { currentMs: store.currentMs, rate: store.rate }

  store.setRate(1)
  store.seek(range.startMs)
  store.setPlaying(true)
  recorder.start(1000)

  let raf = 0
  await new Promise<void>((resolve) => {
    const loop = () => {
      const s = useProject.getState()
      // store 的 currentMs 是 10Hz 的節流鏡像,拿來決定標註何時出現會差到 3 格。
      // 錄的每一幀都要用精確時間。
      const currentMs = playbackClock.currentMs

      ctx.save()
      // 換算比例,讓 renderFrame 永遠在專案座標系裡工作
      ctx.scale(canvas.width / size.w, canvas.height / size.h)
      renderFrame(ctx, { ...s, currentMs }, videos)
      ctx.restore()

      onProgress?.(
        range.durationMs > 0 ? (currentMs - range.startMs) / range.durationMs : 0,
      )

      if (signal?.aborted || !s.playing || currentMs >= range.endMs) {
        resolve()
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
  })
  cancelAnimationFrame(raf)

  recorder.stop()
  const blob = await finished

  store.setPlaying(false)
  store.setRate(restore.rate)
  store.seek(restore.currentMs)
  if (audio?.stopWithTrack) audio.track.stop()

  return { blob, extension: mime.ext }
}

function makeEven(n: number) {
  return Math.max(2, Math.round(n / 2) * 2)
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
