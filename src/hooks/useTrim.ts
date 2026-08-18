import { contentDurationMs, useProject } from '../store/useProject'

/** 刪完至少要留這麼長,跟 store 的 MIN_RANGE_MS 一致 */
export const MIN_KEEP_MS = 200

/**
 * 剪輯的共用狀態與規則。
 *
 * 桌機把剪輯放在播放列上(TrimBar),手機放在分頁面板裡(TrimPanel)——
 * 兩套版面差很遠,但「保留哪一段、切在哪、哪一邊刪得動」完全是同一件事。
 * 抽出來就是為了這個:兩邊的規則不能有一天開始不一樣。
 */
export function useTrim() {
  const durationMs = useProject((s) => s.durationMs)
  const rangeInMs = useProject((s) => s.rangeInMs)
  const rangeOutMs = useProject((s) => s.rangeOutMs)
  const splitAtMs = useProject((s) => s.splitAtMs)
  const countIn = useProject((s) => s.countIn)
  const tempo = useProject((s) => s.tempo)
  const previousRange = useProject((s) => s.previousRange)
  const splitAtPlayhead = useProject((s) => s.splitAtPlayhead)
  const setPlaying = useProject((s) => s.setPlaying)
  const cancelSplit = useProject((s) => s.cancelSplit)
  const deleteSegment = useProject((s) => s.deleteSegment)
  const undoTrim = useProject((s) => s.undoTrim)
  const clearRange = useProject((s) => s.clearRange)

  // 全部用內容時間。剪輯談的是「留下哪一段素材」,
  // 預備拍佔多長是另一件事,歸預備拍面板管。
  const contentMs = contentDurationMs({ durationMs, countIn, tempo })
  const startMs = rangeInMs
  const endMs = rangeOutMs ?? contentMs

  return {
    contentMs,
    range: { startMs, endMs, durationMs: endMs - startMs },
    splitAtMs,
    trimmed: startMs > 0 || endMs < contentMs,
    empty: durationMs <= 0,
    canUndo: previousRange !== null,
    // 切完剩下的那一段太短就不給刪,跟 store 的守門一致
    canDeleteLeft: splitAtMs !== null && endMs - splitAtMs >= MIN_KEEP_MS,
    canDeleteRight: splitAtMs !== null && splitAtMs - startMs >= MIN_KEEP_MS,
    /** 切之前先停下來 —— 邊播邊切,切點會跟眼睛看到的畫面差一截 */
    split: () => {
      setPlaying(false)
      splitAtPlayhead()
    },
    cancelSplit,
    deleteSegment,
    undoTrim,
    clearRange,
  }
}
