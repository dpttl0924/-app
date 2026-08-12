import { describe, expect, it } from 'vitest'
import { screenPositionOf, zoomAround } from './zoom'

const at = (scale: number, offsetX = 0, offsetY = 0) => ({ scale, offsetX, offsetY })

/** 目前顯示在 anchor 位置的,是內容上的哪一點 */
function contentUnder(t: { scale: number; offsetX: number; offsetY: number }, anchor: { x: number; y: number }) {
  return {
    x: (anchor.x - t.offsetX) / t.scale,
    y: (anchor.y - t.offsetY) / t.scale,
  }
}

describe('zoomAround', () => {
  it('錨點底下的內容在縮放前後停在原地', () => {
    // 這就是整個函式存在的理由:錯了的話放大時目標會飄走
    const before = at(1, 40, -20)
    const anchor = { x: 150, y: 90 }
    const pinned = contentUnder(before, anchor)

    const after = zoomAround(before, 2.5, anchor)
    expect(screenPositionOf(after, pinned).x).toBeCloseTo(anchor.x)
    expect(screenPositionOf(after, pinned).y).toBeCloseTo(anchor.y)
  })

  it('縮小時同樣成立', () => {
    const before = at(3, -120, 60)
    const anchor = { x: -80, y: 200 }
    const pinned = contentUnder(before, anchor)

    const after = zoomAround(before, 0.8, anchor)
    expect(screenPositionOf(after, pinned).x).toBeCloseTo(anchor.x)
    expect(screenPositionOf(after, pinned).y).toBeCloseTo(anchor.y)
  })

  it('以中心為錨點時,位移只是等比放大,不會平移', () => {
    const after = zoomAround(at(1, 100, 50), 2, { x: 0, y: 0 })
    expect(after).toEqual({ scale: 2, offsetX: 200, offsetY: 100 })
  })

  it('倍率沒變時什麼都不動', () => {
    const before = at(1.4, 33, -77)
    expect(zoomAround(before, 1.4, { x: 500, y: -300 })).toEqual({
      scale: 1.4,
      offsetX: 33,
      offsetY: -77,
    })
  })

  it('連續縮放不會累積誤差,錨點始終不動', () => {
    let t = at(1, 0, 0)
    const anchor = { x: 210, y: -140 }
    const pinned = contentUnder(t, anchor)
    for (const to of [1.1, 1.21, 1.5, 2.2, 1.3, 0.6, 1]) {
      t = zoomAround(t, to, anchor)
      expect(screenPositionOf(t, pinned).x).toBeCloseTo(anchor.x, 6)
      expect(screenPositionOf(t, pinned).y).toBeCloseTo(anchor.y, 6)
    }
    // 轉了一圈回到 1.0,位移也應該回到原點
    expect(t.offsetX).toBeCloseTo(0)
    expect(t.offsetY).toBeCloseTo(0)
  })
})
