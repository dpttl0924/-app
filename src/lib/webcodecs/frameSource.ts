import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  Input,
  type InputVideoTrack,
  type WrappedCanvas,
} from 'mediabunny'

/**
 * 從輸入檔案取出指定時間的影格。
 *
 * 這是換掉 MediaRecorder 的關鍵。原本的做法是即時播放 `<video>` 再擷取畫面,
 * 所以匯出時間必然等於影片長度。
 *
 * 另一個看似簡單的做法是 seek `<video>` 再 drawImage,但實測每格要 12.27ms ——
 * 一支 3 分鐘影片 66 秒,而匯出要同時取兩支,加起來跟即時錄製差不多,不划算。
 *
 * mediabunny 的 `canvasesAtTimestamps()` 直接走解封裝 + 循序解碼:
 * 時間戳單調遞增時每個封包只解碼一次,不必為了每一格重新 seek。
 */

export interface FrameSource {
  /** 依序取得下一個時間戳的影格。時間戳必須單調遞增。 */
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
 * 建立一個影格來源,依 `timestamps` 逐一產出畫面。
 *
 * @param timestamps 這支素材自己的時間軸(秒),必須單調遞增
 */
export async function createFrameSource(
  blob: Blob,
  timestamps: AsyncIterable<number> | Iterable<number>,
): Promise<FrameSource> {
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
  const iterator = sink.canvasesAtTimestamps(timestamps)

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
