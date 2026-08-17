import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  Input,
  type InputVideoTrack,
  type WrappedCanvas,
} from 'mediabunny'

/**
 * 從輸入檔案依序取出影格,連同它自己的時間戳與長度。
 *
 * 這是換掉 MediaRecorder 的關鍵。原本的做法是即時播放 `<video>` 再擷取畫面,
 * 所以匯出時間必然等於影片長度。
 *
 * 另一個看似簡單的做法是 seek `<video>` 再 drawImage,但實測每格要 12.27ms ——
 * 一支 3 分鐘影片 66 秒,而匯出要同時取兩支,加起來跟即時錄製差不多,不划算。
 *
 * 用 `canvases()` 而不是 `canvasesAtTimestamps()`:後者是給**稀疏**存取用的
 * (「我要第 3.2 秒那一張」),而匯出是從頭讀到尾的循序存取,mediabunny 文件
 * 明講這種情況要用 `canvases()`。更重要的是回傳值帶著影格**自己的** timestamp
 * 與 duration —— 有這個才能照素材原本的節奏排合成時間軸,而不是反過來
 * 先決定一個固定格率、再去把素材硬塞進去(那就是卡頓的來源)。
 */

export interface FrameSource {
  /** 依序取得下一張影格,附帶它在素材時間軸上的位置。沒有了就回傳 null。 */
  next(): Promise<WrappedCanvas | null>
  dispose(): Promise<void>
}

/** 純音檔沒有視訊軌,取影格永遠回傳 null —— 由呼叫端畫佔位畫面 */
const EMPTY_SOURCE: FrameSource = {
  next: async () => null,
  dispose: async () => {},
}

export async function openInput(blob: Blob): Promise<Input> {
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) })
}

/**
 * 建立一個影格來源,產出 `[startSec, endSec)` 這段的每一張影格。
 *
 * 起點會回頭包含**覆蓋** startSec 的那一張(也就是最後一張時間戳 ≤ startSec 的),
 * 不是第一張時間戳 ≥ startSec 的 —— 從影片中間剪起時,起點通常落在某一格中間,
 * 少了這張的話開頭會空一格。
 */
export async function createFrameSource(
  blob: Blob,
  startSec: number,
  endSec: number,
): Promise<FrameSource> {
  if (!(endSec > startSec)) return EMPTY_SOURCE

  const input = await openInput(blob)
  let track: InputVideoTrack | null = null
  try {
    track = await input.getPrimaryVideoTrack()
  } catch {
    track = null
  }
  // 沒有視訊軌(純音檔),或這個瀏覽器解不開這條軌
  if (!track || !(await track.canDecode().catch(() => false))) {
    return EMPTY_SOURCE
  }

  const sink = new CanvasSink(track)
  const iterator = sink.canvases(startSec, endSec)

  return {
    next: async () => {
      const { value, done } = await iterator.next()
      return done ? null : (value ?? null)
    },
    dispose: async () => {
      await iterator.return?.(undefined)
    },
  }
}
