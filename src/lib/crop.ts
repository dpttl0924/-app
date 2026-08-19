import { FULL_CROP, MIN_CROP, type CropRect } from './types'

/**
 * 裁切框的純幾何。
 *
 * 拉框的互動全部落在這裡,元件只負責把指標位置換成位移量。
 * 邊界條件(拉過頭、拉反、縮到零)用測試釘住 —— 這種東西用眼睛測很慢,
 * 而且錯了會直接毀掉使用者的裁切結果。
 */

/** 八個控制點 + 整塊搬移 */
export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

export const CROP_HANDLES: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * 左右翻轉一個裁切框。
 *
 * 鏡像過的影片,畫面上的左邊其實是原片的右邊。裁切存的是原片座標,
 * 但使用者是對著鏡像後的畫面拉框 —— 兩邊要換算,不然框會跑到對稱的另一側。
 *
 * 這是個對合函數(做兩次等於沒做),所以來回兩個方向共用同一支。
 */
export const mirrorCrop = (r: CropRect): CropRect => ({ ...r, x: 1 - r.x - r.w })

/** 鏡像時才翻轉,省得呼叫端到處寫 if */
export const orientCrop = (r: CropRect, mirrored: boolean): CropRect =>
  mirrored ? mirrorCrop(r) : r

/**
 * 拉某一個控制點之後的新框。dx / dy 是正規化的位移量(1 = 整個畫面寬 / 高)。
 *
 * 三條規則:框不能跑出畫面、每邊不能短於 MIN_CROP、拉對邊時另一邊釘住不動。
 */
export function resizeCrop(
  rect: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
): CropRect {
  // 整塊搬移:大小不變,只是不能推出畫面外
  if (handle === 'move') {
    return {
      ...rect,
      x: clamp(rect.x + dx, 0, 1 - rect.w),
      y: clamp(rect.y + dy, 0, 1 - rect.h),
    }
  }

  let { x, y, w, h } = rect

  // 拉左邊:右緣釘住,所以 x 動多少 w 就補回多少
  if (handle.includes('w')) {
    const nx = clamp(x + dx, 0, x + w - MIN_CROP)
    w += x - nx
    x = nx
  }
  if (handle.includes('e')) {
    w = clamp(w + dx, MIN_CROP, 1 - x)
  }
  // 拉上邊:下緣釘住
  if (handle.includes('n')) {
    const ny = clamp(y + dy, 0, y + h - MIN_CROP)
    h += y - ny
    y = ny
  }
  if (handle.includes('s')) {
    h = clamp(h + dy, MIN_CROP, 1 - y)
  }

  return { x, y, w, h }
}

/** 這個框等於沒裁嗎?是的話就存 null,省得整條路徑都要處理「裁了但等於沒裁」 */
export function isFullCrop(r: CropRect): boolean {
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-6
  return same(r.x, 0) && same(r.y, 0) && same(r.w, 1) && same(r.h, 1)
}

/** 存進 store 前收斂一次:等同全畫面就存 null */
export const normaliseCrop = (r: CropRect): CropRect | null =>
  isFullCrop(r) ? null : r

export const cropOrFull = (r: CropRect | null): CropRect => r ?? FULL_CROP
