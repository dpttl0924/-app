export interface ProjectSize {
  w: number
  h: number
}

/**
 * 輸出畫面比例。
 *
 * 手機拍的舞蹈影片幾乎都是直式,鎖死 16:9 的話兩側會是大片黑邊,
 * 分享到 IG / TikTok 也不對版。所以比例是專案層級的設定,不是常數。
 *
 * 預覽與匯出都在這個座標系裡計算,確保所見即所得。
 */
export type AspectRatio = '9:16' | '16:9' | '1:1'

export const ASPECT_SIZES: Record<AspectRatio, ProjectSize> = {
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1920, h: 1080 },
  '1:1': { w: 1080, h: 1080 },
}

export const ASPECT_LABELS: Record<AspectRatio, string> = {
  '9:16': '直式 9:16',
  '16:9': '橫式 16:9',
  '1:1': '方形 1:1',
}

/** 音量包絡的取樣率(Hz)。100Hz = 每 10ms 一個值,足以對齊到 ±10ms。 */
export const ENVELOPE_HZ = 100

export type ClipId = 'a' | 'b'

export type CompareMode = 'overlay' | 'sideBySide' | 'stacked' | 'wipe'

export type BlendMode = 'normal' | 'difference'

export interface ClipTransform {
  /** 1 = 在自己的格子裡 contain 滿版 */
  scale: number
  /** 專案座標系的位移(px) */
  offsetX: number
  offsetY: number
  /**
   * 左右翻轉。
   *
   * 舞蹈比對常常需要:KPOP 的 dance practice 有鏡像版、對著鏡子自拍也會左右相反,
   * 不翻過來的話兩邊動作永遠對不上。
   */
  mirrored: boolean
}

export interface Clip {
  id: ClipId
  url: string
  name: string
  /** 影片本身長度 */
  durationMs: number
  width: number
  height: number
  fps: number
  /** 這段影片在專案時間軸上的起始位置。音訊自動對齊調的就是這個值。 */
  offsetMs: number
  transform: ClipTransform
  volume: number
  /** 音量包絡(ENVELOPE_HZ),用於波形顯示與自動對齊 */
  envelope: Float32Array | null
  /** 起音強度包絡(envelope 的正向差分),自動對齊實際比對的就是它 */
  onset: Float32Array | null
}

export interface Annotation {
  id: string
  timeMs: number
  durationMs: number
  text: string
  /** 相對於畫面的 0..1 座標 */
  x: number
  y: number
  color: string
  /** 專案座標系裡的字級(px) */
  fontSize: number
}

/** 單支影片的縮放範圍。縮太小沒意義,放太大會糊掉。 */
export const MIN_CLIP_SCALE = 0.2
export const MAX_CLIP_SCALE = 4

export const DEFAULT_TRANSFORM: ClipTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  mirrored: false,
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 這支素材有沒有畫面。
 *
 * A/B 兩槽除了影片也接受純音檔(例如只有參考音樂、沒有舞蹈影片的情況)。
 * `<video>` 讀純音檔完全沒問題,只是 videoWidth/videoHeight 會是 0 ——
 * 用這兩個既有欄位判斷,不需要額外的旗標欄位或機率性的檔名/MIME 猜測。
 */
export function isAudioOnly(clip: Clip): boolean {
  return clip.width <= 0 || clip.height <= 0
}
