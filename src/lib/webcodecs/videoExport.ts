import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Output,
  QUALITY_HIGH,
} from 'mediabunny'
import { detectCapabilities, outputFormatFor, type CodecChoice } from './capabilities'
import { createFrameSource, type FrameSource } from './frameSource'
import {
  chooseOutputFps,
  probeDecodability,
  summariseBlockers,
  summariseTiming,
} from './decodeProbe'
import { renderFrame } from '../renderer'
import { resolveClipTime } from '../layout'
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
 */

export interface WebCodecsExportResult {
  blob: Blob
  extension: string
  /** 實際花的時間,用來跟即時錄製比較 */
  elapsedMs: number
  frames: number
  choice: CodecChoice
  /** 實際使用的輸出格率 —— 沒指定的話是跟著素材決定的 */
  fps: number
  /** 素材格率與輸出格率除不盡時的說明,沒問題時是 null */
  judder: string | null
  /** 每支素材實際取到的影格統計 —— 重複與跳格就是卡頓 */
  stats: Record<ClipId, FrameStats>
}

export interface WebCodecsExportOptions {
  /** 相對於專案解析度的縮放 */
  scale?: number
  /** 不給的話依素材的實際格率自動決定 */
  fps?: number
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
  // 順序很重要,有兩個原因:
  // 一是失敗要早 —— 一旦 output.start() 之後才炸,使用者已經等了一段時間,
  // 而且只會拿到一句沒有資訊的「Decoding error」;先檢查的話退回即時錄製
  // 幾乎是瞬間的,而且說得出是哪一支、什麼編碼。
  // 二是輸出格率要看素材的實際格率決定,那也得先讀過檔案才知道。
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

  // 沒指定就跟著素材走 —— 寫死 30fps 會讓 24/25fps 的素材出現 pulldown judder
  const fpsChoice = chooseOutputFps(probes)
  const fps = opts.fps ?? fpsChoice.fps
  const frameMs = 1000 / fps
  const frameCount = Math.max(1, Math.round(range.durationMs / frameMs))

  // 每支素材要在哪些輸出格出現、對應到自己的第幾秒。
  // 先算好整份清單,才能餵給 canvasesAtTimestamps() 走循序解碼的快路。
  const schedules = planFrameSchedules(state, map, range.startMs, frameMs, frameCount)
  const sources: Partial<Record<ClipId, FrameSource>> = {}

  // 實際取到的來源影格統計。
  //
  // 前面幾輪都是靠推理找卡頓的原因,但合成素材重現不出來,推理就沒有著力點。
  // 這裡改成在真正的匯出過程中記錄每一格拿到的來源時間戳 ——
  // 重複(同一格用了兩次)與跳格(中間漏掉)是卡頓在資料上的樣子,直接數出來。
  const stats: Record<ClipId, FrameStats> = {
    a: newStats(),
    b: newStats(),
  }
  const sourceFrameSec: Partial<Record<ClipId, number>> = {}
  for (const p of probes) {
    if (p.fps) sourceFrameSec[p.id] = 1 / p.fps
  }

  const output = new Output({
    format: outputFormatFor(caps.choice.container),
    target: new BufferTarget(),
  })

  const videoSource = new CanvasSource(canvas, {
    codec: caps.choice.video,
    bitrate: QUALITY_HIGH,
  })
  output.addVideoTrack(videoSource, { frameRate: fps })

  // 音訊直接沿用既有的離線混音 —— 它已經處理好偏移、音量與預備拍的節拍器
  const mixed = await renderMixedAudio()
  if (mixed) {
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

  try {
    for (const id of ['a', 'b'] as ClipId[]) {
      const clip = state.clips[id]
      const blob = blobs[id]
      if (!clip || isAudioOnly(clip) || !blob) continue
      sources[id] = await createFrameSource(blob, schedules[id].timestamps)
    }

    // 每支素材各自的「下一個要用的排程索引」
    const cursor: Record<ClipId, number> = { a: 0, b: 0 }
    const current: Record<ClipId, CanvasImageSource | null> = { a: null, b: null }
    const lastTs: Partial<Record<ClipId, number>> = {}

    for (let i = 0; i < frameCount; i++) {
      if (signal?.aborted) throw new Error('已取消')

      // 這一格輪到誰就往前取一張,沒輪到的沿用上一張(影片格率低於輸出格率時會這樣)
      for (const id of ['a', 'b'] as ClipId[]) {
        const schedule = schedules[id]
        const src = sources[id]
        if (!src) continue
        if (schedule.frameIndices[cursor[id]] === i) {
          const wrapped = await src.next()
          if (wrapped) {
            recordStep(stats[id], wrapped.timestamp, lastTs[id], sourceFrameSec[id])
            lastTs[id] = wrapped.timestamp
            current[id] = wrapped.canvas
          } else {
            stats[id].missing++
          }
          cursor[id]++
        }
        // 已經超出這支素材的範圍就不要再畫上一張殘影
        if (!schedule.covers(i)) current[id] = null
      }

      const projectMs = range.startMs + i * frameMs
      ctx.save()
      ctx.scale(canvas.width / size.w, canvas.height / size.h)
      renderFrame(ctx, { ...state, currentMs: projectMs, map }, current)
      ctx.restore()

      await videoSource.add(i / fps, 1 / fps)
      if (i % 10 === 0) onProgress?.(i / frameCount)
    }
  } finally {
    for (const src of Object.values(sources)) await src?.dispose()
  }

  videoSource.close()
  await output.finalize()
  onProgress?.(1)

  const buffer = output.target.buffer
  if (!buffer) throw new Error('匯出沒有產生資料')

  return {
    blob: new Blob([buffer], { type: caps.choice.mimeType }),
    extension: caps.choice.extension,
    elapsedMs: Math.round(performance.now() - started),
    frames: frameCount,
    choice: caps.choice,
    fps,
    judder:
      [
        opts.fps ? null : fpsChoice.judder,
        summariseTiming(probes, fps),
        summariseFrameStats(stats),
      ]
        .filter(Boolean)
        .join(' ') || null,
    stats,
  }
}

export interface FrameStats {
  /** 實際從解碼器取到的影格數 */
  pulled: number
  /** 同一個來源影格被連續用了不只一次 —— 畫面停住 */
  duplicates: number
  /** 來源影格被跳過沒用到 —— 畫面跳一下 */
  skipped: number
  /** 解碼器沒給影格 */
  missing: number
}

const newStats = (): FrameStats => ({
  pulled: 0,
  duplicates: 0,
  skipped: 0,
  missing: 0,
})

/**
 * 記錄這一格相對於上一格前進了幾個來源影格。
 *
 * 1 = 正常。0 = 重複(畫面停住)。>1 = 跳格。
 * 卡頓在資料上就是這兩種值散佈在整段影片裡。
 */
function recordStep(
  s: FrameStats,
  timestamp: number,
  last: number | undefined,
  frameSec: number | undefined,
): void {
  s.pulled++
  if (last === undefined || !frameSec) return
  // 四捨五入到最近的整數格,避免浮點誤差被誤判成重複
  const step = Math.round((timestamp - last) / frameSec)
  if (step <= 0) s.duplicates++
  else if (step > 1) s.skipped += step - 1
}

/** 把統計整理成一句話。沒有異常時回傳 null。 */
export function summariseFrameStats(stats: Record<ClipId, FrameStats>): string | null {
  const bad = (['a', 'b'] as ClipId[]).filter(
    (id) => stats[id].duplicates > 0 || stats[id].skipped > 0 || stats[id].missing > 0,
  )
  if (bad.length === 0) return null

  return (
    bad
      .map((id) => {
        const s = stats[id]
        const pct = s.pulled > 0 ? Math.round(((s.duplicates + s.skipped) / s.pulled) * 100) : 0
        return (
          `影片 ${id.toUpperCase()}:${s.pulled} 格中重複 ${s.duplicates}、` +
          `跳格 ${s.skipped}${s.missing > 0 ? `、缺格 ${s.missing}` : ''}(${pct}%)`
        )
      })
      .join(';') + '。這就是畫面頓的地方。'
  )
}

interface FrameSchedule {
  /** 這支素材需要出現在哪些輸出格(單調遞增) */
  frameIndices: number[]
  /** 對應的素材本身時間(秒,單調遞增) */
  timestamps: number[]
  covers: (frameIndex: number) => boolean
}

/**
 * 算出每支素材要在哪些輸出格出現。
 *
 * 分開算而不是邊跑邊算,是因為 `canvasesAtTimestamps()` 要吃一整串單調遞增的時間戳
 * 才走得到「每個封包只解碼一次」的快路 —— 這正是這條路徑比 seek 快的原因。
 */
export function planFrameSchedules(
  state: ReturnType<typeof useProject.getState>,
  map: ReturnType<typeof timelineMap>,
  startMs: number,
  frameMs: number,
  frameCount: number,
): Record<ClipId, FrameSchedule> {
  const result = {} as Record<ClipId, FrameSchedule>

  for (const id of ['a', 'b'] as ClipId[]) {
    const clip = state.clips[id]
    const frameIndices: number[] = []
    const timestamps: number[] = []
    const covered = new Set<number>()

    if (clip) {
      for (let i = 0; i < frameCount; i++) {
        const contentMs = projectToContent(startMs + i * frameMs, map)
        const { targetSec, inRange } = resolveClipTime(clip, contentMs)
        if (!inRange) continue
        covered.add(i)

        // 只在時間真的往前走的時候才要一張新影格。
        //
        // 預備拍期間 projectToContent 是**凍結**的(畫面停在剪輯起點),
        // 所以那段每一格算出來的 targetSec 完全一樣 ——
        // 4 秒的預備拍會產生 120 個重複時間戳。canvasesAtTimestamps()
        // 要的是單調遞增,重複值會讓解碼器重複 seek 同一個封包而報
        // 「Decoding error」。跳過重複的,主迴圈本來就會沿用上一張。
        const last = timestamps[timestamps.length - 1]
        if (timestamps.length > 0 && targetSec <= last) continue

        frameIndices.push(i)
        timestamps.push(targetSec)
      }
    }

    result[id] = {
      frameIndices,
      timestamps,
      covers: (i) => covered.has(i),
    }
  }
  return result
}
