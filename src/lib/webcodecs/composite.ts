import { contentToProject, projectToContent, type TimelineMap } from '../timeline'
import { resolveClipTime } from '../layout'
import type { Clip, ClipId } from '../types'
import type { FrameSource } from './frameSource'

/**
 * 合成時間軸。
 *
 * ## 為什麼不用固定格率
 *
 * 舊版是先選一個輸出格率,再把兩支素材重新取樣到那個網格上。問題是格率不同時
 * 網格只能遷就其中一支:30fps 的輸出配 25fps 的素材,那一支每秒就有 5 張要重複,
 * 看起來就是「只有其中一支影片會頓」。而 24/25fps 的素材配 30fps 的手機影片
 * 正是這個 App 最常見的組合(網路上抓的舞蹈影片 vs 自己拍的)。
 * 最小公倍數(24 與 30 是 120)高到不能當輸出格率,所以那條路沒有解。
 *
 * 這裡改成反過來:**先看兩支素材各自的影格落在哪些時刻,再由它們決定要合成幾格。**
 * 合成的時刻 = 兩支素材影格時刻的聯集。每一張來源影格都在自己原本的時間點出現,
 * 剛好一次,顯示到下一次有畫面要換為止 —— 沒有重複、沒有跳格,兩支都是。
 *
 * 輸出因此是可變格率(VFR)。MP4/WebM 本來就支援,播放器照 PTS 播,
 * 不需要「輸出格率」這個概念。VFR 的素材(手機錄影很常見)也就一併解決了 ——
 * 它不規則的影格間隔會被原樣保留,而不是被量化到網格上。
 *
 * ## 代價
 *
 * 格數變成兩支的總和。兩支都是 30fps 但對齊偏移不是整格時,聯集會是 60 個時刻。
 * 這也是 SNAP_RATIO 存在的原因(見下)。
 */

/**
 * 兩支素材的影格時刻差在四分之一格以內時,併成同一刻。
 *
 * 沒有這個的話,兩支同為 30fps、對齊偏移 5ms 的素材會合成出 60fps ——
 * 格數翻倍、編碼時間翻倍,但畫面完全沒有變好:那 5ms 是固定的相位差,
 * 不是節奏不對。併起來之後其中一支的畫面早 5ms 出現,遠低於一格的長度,
 * 肉眼分辨不出來。
 *
 * 上限選四分之一格而不是二分之一:超過四分之一之後,誤差已經大到會讓
 * 「每格顯示多久」本身變得不平均,那就重新變成頓了。四分之一以內的偏移
 * 不會改變影格的先後順序,也不會讓任何一張被吃掉。
 */
export const SNAP_RATIO = 0.25

/**
 * 兩支都沒有新影格時,一格最長顯示這麼久。
 *
 * 預備拍期間畫面是**凍結**的(那段時間軸上沒有影片內容,只有節拍器),
 * 沒有這個上限的話 4 秒的預備拍會變成一張長度 4 秒的影格。
 * 容器裝得下,但播放器拖時間軸會很難用,而且標註的出現時機會被拖到下一格才生效。
 * 100ms(10fps)是靜止畫面看不出差別、又不會多產生多少資料的折衷。
 */
export const MAX_FRAME_MS = 100

export interface CompositeTrack {
  id: ClipId
  clip: Clip
  source: FrameSource
  /** 實際用掉幾張來源影格。由 composeTimeline() 累加。 */
  used: number
}

export interface CompositeFrame {
  /** 這一格在專案時間軸上的位置 */
  atMs: number
  /** 顯示多久 —— 到下一次有畫面要換為止 */
  durationMs: number
  /** 這一刻每支素材該顯示的畫面。null = 這一刻它不該出現。 */
  sources: Record<ClipId, CanvasImageSource | null>
}

/**
 * 一張來源影格會出現在專案時間軸的哪一刻。
 *
 * 素材時間 → 內容時間(加上這支的對齊偏移)→ 專案時間(跳過預備拍那段)。
 *
 * 剪輯起點之前的影格一律夾到起點:從影片中間剪起時,覆蓋起點的那一張本身的
 * 時間戳是在起點之前的,但它就是預備拍期間要凍在畫面上的那一張。
 */
export function frameProjectMs(
  clip: Clip,
  timestampSec: number,
  map: TimelineMap,
  startMs: number,
): number {
  const contentMs = timestampSec * 1000 + clip.offsetMs
  if (contentMs <= map.countInAtMs) return startMs
  return contentToProject(contentMs, map)
}

/**
 * 把兩支素材的影格合併成一條合成時間軸。
 *
 * 每產出一格就是「這一刻畫面長這樣,要顯示這麼久」,呼叫端拿去畫圖 + 編碼。
 * 產出的 `atMs` 嚴格遞增,`durationMs` 永遠大於 0。
 */
export async function* composeTimeline(
  tracks: CompositeTrack[],
  map: TimelineMap,
  startMs: number,
  endMs: number,
): AsyncGenerator<CompositeFrame> {
  if (!(endMs > startMs)) return

  const pending = new Map<ClipId, Awaited<ReturnType<FrameSource['next']>>>()
  const shown = new Map<ClipId, CanvasImageSource | null>()
  for (const track of tracks) {
    pending.set(track.id, await track.source.next())
    shown.set(track.id, null)
  }

  /** 這支素材待命中的那一張該在哪一刻出現。沒有待命的就是 Infinity。 */
  const pendingAt = (track: CompositeTrack): number => {
    const next = pending.get(track.id)
    return next ? frameProjectMs(track.clip, next.timestamp, map, startMs) : Infinity
  }

  let atMs = startMs
  while (atMs < endMs) {
    // 這一刻該換的畫面都換上。快到看不出來的(SNAP_RATIO 以內)也算這一刻。
    for (const track of tracks) {
      for (;;) {
        const next = pending.get(track.id)
        if (!next) break
        if (pendingAt(track) > atMs + next.duration * 1000 * SNAP_RATIO) break
        shown.set(track.id, next.canvas)
        track.used++
        pending.set(track.id, await track.source.next())
      }
    }

    // 下一次有畫面要換是什麼時候 —— 這一格就顯示到那裡為止
    let nextMs = endMs
    for (const track of tracks) {
      const at = pendingAt(track)
      if (at > atMs && at < nextMs) nextMs = at
    }
    if (nextMs - atMs > MAX_FRAME_MS) nextMs = atMs + MAX_FRAME_MS

    // 已經播完的素材不能留著最後一張當殘影,還沒進場的也不該先出現
    const contentMs = projectToContent(atMs, map)
    const sources: Record<ClipId, CanvasImageSource | null> = { a: null, b: null }
    for (const track of tracks) {
      const { inRange } = resolveClipTime(track.clip, contentMs)
      sources[track.id] = inRange ? (shown.get(track.id) ?? null) : null
    }

    yield { atMs, durationMs: nextMs - atMs, sources }
    atMs = nextMs
  }
}
