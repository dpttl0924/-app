import { ASPECT_SIZES, type AspectRatio } from './types'
import { cropOrFull } from './crop'
import type {
  Clip,
  ClipId,
  ClipTransform,
  CompareMode,
  ProjectSize,
  Rect,
} from './types'

/**
 * 這個檔案是「預覽」與「匯出」共用的唯一幾何來源。
 *
 * 預覽走 CSS(絕對定位 + object-fit: contain + transform),
 * 匯出走 Canvas(translate / rotate / scale + drawImage),
 * 兩者都只從這裡取數字 —— 所見即所得的保證就在這裡。
 * 任何時候要改版面規則,只能改這個檔案。
 */

/** 某段影片在某個對比模式下佔的格子(專案座標系) */
export function slotRect(mode: CompareMode, id: ClipId, size: ProjectSize): Rect {
  switch (mode) {
    case 'sideBySide':
      return {
        x: id === 'a' ? 0 : size.w / 2,
        y: 0,
        w: size.w / 2,
        h: size.h,
      }
    case 'stacked':
      return {
        x: 0,
        y: id === 'a' ? 0 : size.h / 2,
        w: size.w,
        h: size.h / 2,
      }
    case 'overlay':
    case 'wipe':
    default:
      return { x: 0, y: 0, w: size.w, h: size.h }
  }
}

/**
 * 裁切之後實際會被用到的來源尺寸。沒裁切就是原片尺寸。
 *
 * 整條路徑都從這裡取「這支影片有多大」,裁切才會自動變成
 * 「留下的那塊放大填滿格子」—— contain 的對象換成裁切後的區域,
 * 縮放倍率自然就跟著變大,不需要另外算一組放大係數。
 */
export function croppedSize(clip: Clip): { w: number; h: number } {
  const c = cropOrFull(clip.crop)
  return { w: clip.width * c.w, h: clip.height * c.h }
}

/** 影片(裁切後)以 contain 方式塞進格子後的實際尺寸(未套用 transform) */
export function containSize(clip: Clip, slot: Rect): { w: number; h: number } {
  const src = croppedSize(clip)
  if (!src.w || !src.h) return { w: slot.w, h: slot.h }
  const s = Math.min(slot.w / src.w, slot.h / src.h)
  return { w: src.w * s, h: src.h * s }
}

/**
 * 預覽用的裁切幾何(專案座標系)。
 *
 * CSS 沒有 drawImage 的九參數版本,所以改成三層:
 * 外層開一個「裁切後大小」的視窗、裡面放一張放大到 1/crop 倍的完整影片、
 * 再往左上推到對的位置。數字全部從這裡出,才跟 drawClip() 走同一份幾何。
 *
 * 沒裁切時 full === view、offset 是 0,退化成原本的 object-fit: contain。
 */
export function cropFrame(clip: Clip, slot: Rect) {
  const view = containSize(clip, slot)
  const c = cropOrFull(clip.crop)
  const full = { w: view.w / c.w, h: view.h / c.h }
  return { view, full, offset: { x: -c.x * full.w, y: -c.y * full.h } }
}

/**
 * 水平縮放係數。鏡像就是把 x 軸的縮放取負號。
 *
 * 排在 translate 之後(也就是先作用在影像上),所以翻的是「影片內容」而不是整個版面:
 * 位移不會跟著左右顛倒,翻轉前擺好的位置不會跑掉。
 */
function scaleX(t: ClipTransform): number {
  return t.mirrored ? -t.scale : t.scale
}

/**
 * 給 CSS 用的 transform 字串。
 * 順序必須與 drawClip() 的 canvas 操作順序一致:translate → scale。
 *
 * 位移刻意輸出成百分比而非 px:影片元素本身就是一整格大小,
 * 所以「格子寬的 x%」不管畫面被縮到多小都成立,不需要 JS 量任何東西。
 * 換算關係:offsetX / slot.w × slot.w = offsetX,與 canvas 路徑等價。
 */
export function cssTransform(clip: Clip, slot: Rect): string {
  const t = clip.transform
  const tx = (t.offsetX / slot.w) * 100
  const ty = (t.offsetY / slot.h) * 100
  return `translate(${tx}%, ${ty}%) scale(${scaleX(t)}, ${t.scale})`
}

/**
 * 影片在格子裡佔到的面積比例(0..1)。1 = 剛好填滿,0.5 = 一半是黑邊。
 *
 * 手機拍的是直式、預設輸出也是直式,但「左右並排兩支直式影片」放進直式框裡,
 * 每格會變成又窄又高,影片上下全是黑邊 —— 這種組合用文字說不清楚,
 * 直接算給使用者看比較快。
 */
export function slotCoverage(clip: Clip, slot: Rect): number {
  const fit = containSize(clip, slot)
  return (fit.w * fit.h) / (slot.w * slot.h)
}

/** 目前這組(影片 + 模式 + 輸出比例)平均佔多少畫面。沒有影片時回傳 1。 */
export function averageCoverage(
  clips: (Clip | null)[],
  mode: CompareMode,
  size: ProjectSize,
): number {
  const loaded = clips.filter((c): c is Clip => c !== null && c.width > 0)
  if (loaded.length === 0) return 1
  const total = loaded.reduce(
    (sum, clip) => sum + slotCoverage(clip, slotRect(mode, clip.id, size)),
    0,
  )
  return total / loaded.length
}

/** 這組影片與模式下,黑邊最少的輸出比例 */
export function bestAspect(clips: (Clip | null)[], mode: CompareMode): AspectRatio {
  const candidates = Object.keys(ASPECT_SIZES) as AspectRatio[]
  return candidates.reduce((best, aspect) =>
    averageCoverage(clips, mode, ASPECT_SIZES[aspect]) >
    averageCoverage(clips, mode, ASPECT_SIZES[best])
      ? aspect
      : best,
  )
}

export interface ClipTimeResolution {
  /** 這段影片該播到的秒數(已夾在 0..durationMs 之間) */
  targetSec: number
  /** 專案時間是否落在這段影片的範圍內。false 代表要暫停並停在頭或尾。 */
  inRange: boolean
}

/**
 * 專案時間 → 單段影片的播放位置。
 *
 * 這段算術是雙影片同步最容易寫錯的地方:offset 的正負方向弄反,
 * 畫面照樣會動,只是兩邊差了兩倍的偏移量 —— 很難用眼睛發現。
 * 所以獨立成純函式並用測試釘住。
 */
export function resolveClipTime(clip: Clip, projectMs: number): ClipTimeResolution {
  const raw = projectMs - clip.offsetMs
  return {
    targetSec: Math.max(0, Math.min(raw, clip.durationMs)) / 1000,
    inRange: raw >= 0 && raw <= clip.durationMs,
  }
}

/** 整個專案的長度 = 所有影片(含 offset)的最大結束時間 */
export function projectDuration(clips: (Clip | null)[]): number {
  return clips.reduce(
    (max, c) => (c ? Math.max(max, c.offsetMs + c.durationMs) : max),
    0,
  )
}

/**
 * 把一段影片畫到 canvas 上。與 CSS 預覽等價。
 * source 可以是 <video>,也可以是任何 CanvasImageSource。
 */
export function drawClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  source: CanvasImageSource,
  mode: CompareMode,
  size: ProjectSize,
) {
  const slot = slotRect(mode, clip.id, size)
  const fit = containSize(clip, slot)
  const t = clip.transform

  ctx.save()
  // 先裁切到自己的格子,避免 scale 放大後蓋到隔壁
  ctx.beginPath()
  ctx.rect(slot.x, slot.y, slot.w, slot.h)
  ctx.clip()

  ctx.translate(slot.x + slot.w / 2 + t.offsetX, slot.y + slot.h / 2 + t.offsetY)
  // x 軸為負時,drawImage 就會以中心為軸左右翻轉 —— 與 CSS 的 scale(-s, s) 等價
  ctx.scale(scaleX(t), t.scale)

  // 裁切是「只取來源的這一塊」,所以走九參數版本。
  // 目的地矩形不變(仍是 contain 的結果),但 contain 的對象已經是裁切後的尺寸,
  // 所以那一塊會自動被放大到填滿格子。
  const src = sourceRect(clip, source)
  if (src) {
    ctx.drawImage(source, src.x, src.y, src.w, src.h, -fit.w / 2, -fit.h / 2, fit.w, fit.h)
  } else {
    ctx.drawImage(source, -fit.w / 2, -fit.h / 2, fit.w, fit.h)
  }
  ctx.restore()
}

/**
 * 裁切區在來源影像**自己的**像素座標裡是哪一塊。沒裁切回傳 null。
 *
 * 尺寸刻意從 source 現量,而不是用 clip.width/height:
 * 預覽餵進來的是 <video>,匯出餵進來的是解碼出來的 canvas,兩者的內在尺寸
 * 不保證一樣。crop 是 0..1 的比例,乘上各自的實際尺寸才會對上同一塊畫面。
 */
function sourceRect(clip: Clip, source: CanvasImageSource): Rect | null {
  if (!clip.crop) return null
  const s = intrinsicSize(source)
  if (!s) return null
  const c = clip.crop
  return { x: c.x * s.w, y: c.y * s.h, w: c.w * s.w, h: c.h * s.h }
}

function intrinsicSize(source: CanvasImageSource): { w: number; h: number } | null {
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
    return source.videoWidth > 0
      ? { w: source.videoWidth, h: source.videoHeight }
      : null
  }
  // canvas / OffscreenCanvas / ImageBitmap 都直接有數值的 width / height
  const s = source as { width?: number; height?: number }
  return s.width && s.height ? { w: s.width, h: s.height } : null
}
