import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Output,
  QUALITY_HIGH,
} from 'mediabunny'
import { detectCapabilities, outputFormatFor, type CodecChoice } from './capabilities'
import { createFrameSource, type FrameSource } from './frameSource'
import { composeTimeline, type CompositeTrack } from './composite'
import { probeDecodability, summariseBlockers, summariseRates } from './decodeProbe'
import { renderFrame } from '../renderer'
import { projectToContent } from '../timeline'
import { renderMixedAudio } from '../audioExport'
import { playRange, timelineMap, useProject } from '../../store/useProject'
import { ASPECT_SIZES, isAudioOnly, type ClipId } from '../types'

/**
 * WebCodecs 匯出。
 *
 * 與 MediaRecorder 版本最大的差別是**不必即時播放**:
 * 影格直接從檔案解碼出來,想跑多快就多快,不再是「3 分鐘的影片等 3 分鐘」。
 * 也不需要一直開著畫面 —— 切到別的 App 或鎖螢幕都不影響。
 *
 * 合成的部分完全重用 `renderFrame()`,跟預覽與 MediaRecorder 走同一份幾何,
 * 所以三條路徑畫出來的東西一致。
 *
 * 輸出的時間軸由兩支素材自己的影格時刻決定(見 composite.ts),不是固定格率。
 */

export interface WebCodecsExportResult {
  blob: Blob
  extension: string
  /** 實際花的時間,用來跟即時錄製比較 */
  elapsedMs: number
  /** 合成出幾格 */
  frames: number
  /** 每支素材實際用掉幾張來源影格 */
  sourceFrames: Record<ClipId, number>
  choice: CodecChoice
  /** 平均格率 —— 輸出是可變格率,所以只有平均值有意義 */
  avgFps: number
  /** 素材格率的說明,沒什麼好講的時候是 null */
  note: string | null
}

export interface WebCodecsExportOptions {
  /** 相對於專案解析度的縮放 */
  scale?: number
  onProgress?: (ratio: number) => void
  signal?: AbortSignal
}

export class WebCodecsUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebCodecsUnavailableError'
  }
}

const makeEven = (n: number) => Math.max(2, Math.round(n / 2) * 2)

export async function exportWithWebCodecs(
  opts: WebCodecsExportOptions = {},
): Promise<WebCodecsExportResult> {
  const { scale = 1, onProgress, signal } = opts
  const caps = await detectCapabilities()
  if (!caps.choice) {
    throw new WebCodecsUnavailableError(
      caps.hasWebCodecs
        ? '這個瀏覽器的 WebCodecs 沒有可用的視訊編碼器'
        : '這個瀏覽器不支援 WebCodecs',
    )
  }

  const state = useProject.getState()
  const range = playRange(state)
  if (range.durationMs <= 0) throw new Error('輸出範圍是空的')

  const size = ASPECT_SIZES[state.aspect]
  const map = timelineMap(state)

  const canvas = document.createElement('canvas')
  canvas.width = makeEven(size.w * scale)
  canvas.height = makeEven(size.h * scale)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('無法建立 canvas context')

  const started = performance.now()

  // 先把素材讀進來檢查,再開始編碼。
  //
  // 順序很重要:一旦 output.start() 之後才炸,使用者已經等了一段時間,
  // 而且只會拿到一句沒有資訊的「Decoding error」;先檢查的話退回即時錄製
  // 幾乎是瞬間的,而且說得出是哪一支、什麼編碼。
  const blobs: Partial<Record<ClipId, Blob>> = {}
  const probes = []
  for (const id of ['a', 'b'] as ClipId[]) {
    const clip = state.clips[id]
    if (!clip || isAudioOnly(clip)) continue
    const blob = await fetch(clip.url).then((r) => r.blob())
    blobs[id] = blob
    probes.push(await probeDecodability(id, blob))
  }

  const blocked = summariseBlockers(probes)
  if (blocked) throw new WebCodecsUnavailableError(blocked)

  // 要解碼的內容區間。範圍的起訖是專案時間,素材吃的是內容時間。
  const contentStartMs = projectToContent(range.startMs, map)
  const contentEndMs = projectToContent(range.endMs, map)

  const output = new Output({
    format: outputFormatFor(caps.choice.container),
    target: new BufferTarget(),
  })

  const videoSource = new CanvasSource(canvas, {
    codec: caps.choice.video,
    bitrate: QUALITY_HIGH,
  })
  // 刻意不給 frameRate:mediabunny 會用它把每一格的時間戳吸附回固定格率,
  // 那正好抵消掉這條路徑的重點(見 composite.ts)。
  output.addVideoTrack(videoSource)

  // 音訊直接沿用既有的離線混音 —— 它已經處理好偏移、音量與預備拍的節拍器
  const mixed = caps.choice.audio ? await renderMixedAudio() : null
  if (mixed && caps.choice.audio) {
    const audioSource = new AudioBufferSource({
      codec: caps.choice.audio,
      bitrate: QUALITY_HIGH,
    })
    output.addAudioTrack(audioSource)
    await output.start()
    await audioSource.add(mixed)
    audioSource.close()
  } else {
    await output.start()
  }

  const tracks: CompositeTrack[] = []
  const sources: FrameSource[] = []
  let frames = 0

  try {
    for (const id of ['a', 'b'] as ClipId[]) {
      const clip = state.clips[id]
      const blob = blobs[id]
      if (!clip || isAudioOnly(clip) || !blob) continue
      const source = await createFrameSource(
        blob,
        Math.max(0, contentStartMs - clip.offsetMs) / 1000,
        Math.min(clip.durationMs, contentEndMs - clip.offsetMs) / 1000,
      )
      sources.push(source)
      tracks.push({ id, clip, source, used: 0 })
    }

    for await (const frame of composeTimeline(tracks, map, range.startMs, range.endMs)) {
      if (signal?.aborted) throw new Error('已取消')

      ctx.save()
      ctx.scale(canvas.width / size.w, canvas.height / size.h)
      renderFrame(ctx, { ...state, currentMs: frame.atMs, map }, frame.sources)
      ctx.restore()

      await videoSource.add(
        (frame.atMs - range.startMs) / 1000,
        frame.durationMs / 1000,
      )
      frames++
      if (frames % 10 === 0) {
        onProgress?.((frame.atMs - range.startMs) / range.durationMs)
      }
    }
  } finally {
    for (const source of sources) await source.dispose()
  }

  videoSource.close()
  await output.finalize()
  onProgress?.(1)

  const buffer = output.target.buffer
  if (!buffer) throw new Error('匯出沒有產生資料')

  const sourceFrames: Record<ClipId, number> = { a: 0, b: 0 }
  for (const track of tracks) sourceFrames[track.id] = track.used

  return {
    blob: new Blob([buffer], { type: caps.choice.mimeType }),
    extension: caps.choice.extension,
    elapsedMs: Math.round(performance.now() - started),
    frames,
    sourceFrames,
    choice: caps.choice,
    avgFps: Math.round((frames / (range.durationMs / 1000)) * 10) / 10,
    note: summariseRates(probes),
  }
}
