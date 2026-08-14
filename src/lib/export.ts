import { renderFrame } from './renderer'
import { countInPlan, playRange, timelineMap, useProject } from '../store/useProject'
import { audioContext, resumeAudio, sourceFor } from './audioBus'
import { scheduleClicks } from './metronome'
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

interface ExportAudio {
  track: MediaStreamTrack | null
  /** 匯出結束時要斷開的連線與排程 */
  dispose: () => void
}

/**
 * 準備匯出用的音軌:影片的聲音 + 預備拍的節拍器,混進同一條。
 *
 * 全部走 Web Audio 而不是 `video.captureStream()`,有兩個理由:
 *   1. Safari 根本沒實作 HTMLMediaElement.captureStream(),iPhone 上會靜音
 *   2. 要跟節拍器混音,本來就得進 Web Audio 圖
 *
 * 抓不到聲音時輸出無聲,不讓整個匯出失敗 —— 畫面通常才是重點。
 */
function prepareAudio(videos: Record<ClipId, HTMLVideoElement | null>): ExportAudio {
  const state = useProject.getState()
  const ac = audioContext()
  const dest = ac.createMediaStreamDestination()
  const connected: AudioNode[] = []

  // 影片的聲音:音量大於零的都接進來
  for (const id of ['a', 'b'] as ClipId[]) {
    const el = videos[id]
    const clip = state.clips[id]
    if (!el || !clip || clip.volume <= 0) continue
    const source = sourceFor(el)
    if (!source) continue
    source.connect(dest)
    connected.push(source)
  }

  // 節拍器:錄製起點就是剪輯起點,也正是預備拍的開頭,所以 click 的時間可以直接用
  const plan = countInPlan(state.countIn, state.tempo?.phaseMs ?? 0)
  const metronome =
    plan.clickTimesMs.length > 0
      ? scheduleClicks(ac, plan.clickTimesMs, {
          volume: state.countIn.volume,
          destinations: [dest, ac.destination],
        })
      : null

  return {
    track: dest.stream.getAudioTracks()[0] ?? null,
    dispose: () => {
      metronome?.cancel()
      // 只斷開這次接上的線。source 節點本身要留著 —— 同一個 element
      // 不能再 createMediaElementSource 第二次。
      for (const node of connected) {
        try {
          node.disconnect(dest)
        } catch {
          // 已經斷開就算了
        }
      }
    },
  }
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
  // 節拍器要相對於錄製起點排程,所以先喚醒 AudioContext 再開始
  await resumeAudio()
  const audio = prepareAudio(videos)
  if (audio.track) stream.addTrack(audio.track)

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
      // renderFrame 現在收的是通用的畫面來源,「這一格能不能用」由呼叫端判斷
      renderFrame(ctx, { ...s, currentMs, map: timelineMap(s) }, {
        a: readyOrNull(videos.a),
        b: readyOrNull(videos.b),
      })
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
  audio.dispose()

  return { blob, extension: mime.ext }
}

function makeEven(n: number) {
  return Math.max(2, Math.round(n / 2) * 2)
}

/** readyState < 2 的 video 畫出來是空白,當成「這一格沒有畫面」 */
function readyOrNull(el: HTMLVideoElement | null): HTMLVideoElement | null {
  return el && el.readyState >= 2 ? el : null
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
