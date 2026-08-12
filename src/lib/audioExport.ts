import { countInDurationMs, countInPlan, playRange, useProject } from '../store/useProject'
import { createClick } from './metronome'
import { encodeWav } from './wav'
import type { Clip, ClipId } from './types'

/**
 * 純音訊匯出。
 *
 * 走 OfflineAudioContext 離線算完,不是即時錄製 ——
 * 3 分鐘的專案幾秒就好,而且不需要一直開著畫面。
 * 影像的匯出還在 MediaRecorder 上受這個限制,音訊這條先跳過去了。
 *
 * 這也等於先鋪好 WebCodecs 的一半:換過去之後音訊本來就要離線混音,
 * 這套混音邏輯可以原封不動沿用,只是最後改接 AudioEncoder 而不是寫 WAV。
 */

const OUTPUT_SAMPLE_RATE = 44100
const OUTPUT_CHANNELS = 2

export interface AudioExportResult {
  blob: Blob
  durationMs: number
}

/** blob: URL 讀得回原始資料,所以不必為了匯出額外保留 File 物件 */
async function decodeClip(ctx: BaseAudioContext, clip: Clip): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(clip.url)
    return await ctx.decodeAudioData(await res.arrayBuffer())
  } catch {
    return null
  }
}

export async function exportAudio(
  onProgress?: (ratio: number) => void,
): Promise<AudioExportResult> {
  const state = useProject.getState()
  const range = playRange(state)
  if (range.durationMs <= 0) throw new Error('輸出範圍是空的')

  const frames = Math.ceil((range.durationMs / 1000) * OUTPUT_SAMPLE_RATE)
  const ctx = new OfflineAudioContext(OUTPUT_CHANNELS, frames, OUTPUT_SAMPLE_RATE)
  const countInMs = countInDurationMs(state)
  // 輸出的時間軸:[0, countInMs) 是預備拍,之後接保留的內容
  const keepFromMs = state.rangeInMs

  onProgress?.(0.05)

  // 影片的聲音
  const ids: ClipId[] = ['a', 'b']
  let mixed = 0
  for (const id of ids) {
    const clip = state.clips[id]
    if (!clip || clip.volume <= 0) continue

    const buffer = await decodeClip(ctx, clip)
    if (!buffer) continue

    // 這支影片從內容時間 offsetMs 開始;保留的段落從 keepFromMs 開始。
    // 兩者取晚的那個當作實際要放的起點。
    const startContentMs = Math.max(keepFromMs, clip.offsetMs)
    const whenSec = (countInMs + startContentMs - keepFromMs) / 1000
    // 起點落在影片中間的話,從 buffer 的對應位置切進去
    const seekSec = (startContentMs - clip.offsetMs) / 1000
    if (seekSec >= buffer.duration) continue

    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = clip.volume
    source.connect(gain).connect(ctx.destination)
    source.start(whenSec, seekSec)
    mixed++
    onProgress?.(0.05 + 0.35 * mixed)
  }

  // 節拍器:輸出的 0 秒就是預備拍的開頭,click 的時間可以直接用
  const plan = countInPlan(state.countIn, state.tempo?.phaseMs ?? 0)
  plan.clickTimesMs.forEach((tMs, index) => {
    const whenSec = tMs / 1000
    if (whenSec >= range.durationMs / 1000) return
    // 與預覽共用同一份,音色與重音規則不會分岔
    createClick(ctx, index, whenSec, state.countIn.volume, [ctx.destination])
  })

  onProgress?.(0.5)
  const rendered = await ctx.startRendering()
  onProgress?.(0.85)
  const blob = encodeWav(rendered)
  onProgress?.(1)

  return { blob, durationMs: range.durationMs }
}
