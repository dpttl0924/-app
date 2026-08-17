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

/**
 * 把整個專案的聲音離線混成一段 AudioBuffer:兩支素材的音訊 + 預備拍的節拍器。
 *
 * 抽出來是因為有兩個消費端 —— 純音訊匯出(寫成 WAV)與 WebCodecs 影片匯出
 * (餵給 AudioEncoder)。混音邏輯只寫一份,兩邊的聲音才不會有一天開始不一樣。
 *
 * 沒有任何有聲來源時回傳 null,呼叫端自己決定要不要輸出無聲軌。
 */
export async function renderMixedAudio(
  onProgress?: (ratio: number) => void,
): Promise<AudioBuffer | null> {
  const state = useProject.getState()
  const range = playRange(state)
  if (range.durationMs <= 0) return null

  const frames = Math.ceil((range.durationMs / 1000) * OUTPUT_SAMPLE_RATE)
  const ctx = new OfflineAudioContext(OUTPUT_CHANNELS, frames, OUTPUT_SAMPLE_RATE)
  const countInMs = countInDurationMs(state)
  // 輸出的時間軸:[0, countInMs) 是預備拍,之後接保留的內容
  const keepFromMs = state.rangeInMs

  onProgress?.(0.05)

  const ids: ClipId[] = ['a', 'b']
  let mixed = 0
  for (const id of ids) {
    const clip = state.clips[id]
    if (!clip || clip.volume <= 0) continue

    const buffer = await decodeClip(ctx, clip)
    if (!buffer) continue

    // 這支素材從內容時間 offsetMs 開始;保留的段落從 keepFromMs 開始。
    // 兩者取晚的那個當作實際要放的起點。
    const startContentMs = Math.max(keepFromMs, clip.offsetMs)
    const whenSec = (countInMs + startContentMs - keepFromMs) / 1000
    // 起點落在素材中間的話,從 buffer 的對應位置切進去
    const seekSec = (startContentMs - clip.offsetMs) / 1000
    if (seekSec >= buffer.duration) continue

    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = clip.volume
    source.connect(gain).connect(ctx.destination)
    source.start(whenSec, seekSec)
    mixed++
    // 兩支素材各佔解碼階段的一半 —— 之前是 0.05 + 0.35 × mixed,
    // 第二支就會跳到 0.75,接著又被後面的 0.5 拉回去,進度條會倒退
    onProgress?.(0.05 + 0.45 * (mixed / ids.length))
  }

  // 節拍器:輸出的 0 秒就是預備拍的開頭,click 的時間可以直接用
  const plan = countInPlan(state.countIn, state.tempo?.phaseMs ?? 0)
  let clicks = 0
  plan.clickTimesMs.forEach((tMs, index) => {
    const whenSec = tMs / 1000
    if (whenSec >= range.durationMs / 1000) return
    // 與預覽共用同一份,音色與重音規則不會分岔
    createClick(ctx, index, whenSec, state.countIn.volume, [ctx.destination])
    clicks++
  })

  if (mixed === 0 && clicks === 0) return null

  onProgress?.(0.5)
  return ctx.startRendering()
}

export async function exportAudio(
  onProgress?: (ratio: number) => void,
): Promise<AudioExportResult> {
  const state = useProject.getState()
  const range = playRange(state)
  if (range.durationMs <= 0) throw new Error('輸出範圍是空的')

  const rendered = await renderMixedAudio(onProgress)
  if (!rendered) throw new Error('沒有可匯出的聲音')
  onProgress?.(0.85)
  const blob = encodeWav(rendered)
  onProgress?.(1)

  return { blob, durationMs: range.durationMs }
}
