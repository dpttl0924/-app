/**
 * 以某一點為錨點的縮放。
 *
 * 預設的縮放是繞著格子中心,放大時你盯著的那個點會往外飄走,
 * 每放大一次就要重新拖回來找目標 —— 滾輪縮放這樣完全不能用。
 *
 * 推導:內容上某一點 c 出現在(相對格子中心的)位置 `offset + scale · c`。
 * 要讓錨點 anchor 底下的那一點在縮放前後停在原地:
 *   c = (anchor − offset) / from
 *   offset' + to · c = anchor
 *   → offset' = offset · k + anchor · (1 − k),其中 k = to / from
 */
export interface ZoomAnchor {
  /** 錨點相對於這一格中心的位移(專案座標系 px) */
  x: number
  y: number
}

export interface ZoomResult {
  scale: number
  offsetX: number
  offsetY: number
}

export function zoomAround(
  current: { scale: number; offsetX: number; offsetY: number },
  to: number,
  anchor: ZoomAnchor,
): ZoomResult {
  const k = to / current.scale
  return {
    scale: to,
    offsetX: current.offsetX * k + anchor.x * (1 - k),
    offsetY: current.offsetY * k + anchor.y * (1 - k),
  }
}

/** 內容上的某一點,現在顯示在(相對格子中心的)哪個位置 */
export function screenPositionOf(
  transform: { scale: number; offsetX: number; offsetY: number },
  contentPoint: { x: number; y: number },
) {
  return {
    x: transform.offsetX + transform.scale * contentPoint.x,
    y: transform.offsetY + transform.scale * contentPoint.y,
  }
}
