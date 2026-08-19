import { describe, expect, it } from 'vitest'
import {
  isFullCrop,
  mirrorCrop,
  normaliseCrop,
  orientCrop,
  resizeCrop,
} from './crop'
import { FULL_CROP, MIN_CROP, type CropRect } from './types'

const r = (x: number, y: number, w: number, h: number): CropRect => ({ x, y, w, h })
const half = r(0.25, 0.25, 0.5, 0.5)

/** 逐項 closeTo。`1 - x - w` 這種算式的浮點殘渣不是缺陷,但 toEqual 會被它絆倒。 */
const expectRect = (got: CropRect, want: CropRect) => {
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    expect(got[k], `${k}`).toBeCloseTo(want[k], 10)
  }
}

describe('拉控制點', () => {
  it('拉右邊只動寬度,左緣釘住', () => {
    expectRect(resizeCrop(half, 'e', 0.1, 0), r(0.25, 0.25, 0.6, 0.5))
  })

  it('拉左邊時右緣釘住 —— x 動多少寬度就補回多少', () => {
    const out = resizeCrop(half, 'w', 0.1, 0)
    expect(out.x).toBeCloseTo(0.35)
    expect(out.w).toBeCloseTo(0.4)
    // 右緣完全沒動
    expect(out.x + out.w).toBeCloseTo(half.x + half.w)
  })

  it('拉上邊時下緣釘住', () => {
    const out = resizeCrop(half, 'n', 0, -0.1)
    expect(out.y).toBeCloseTo(0.15)
    expect(out.y + out.h).toBeCloseTo(half.y + half.h)
  })

  it('角落同時動兩個方向', () => {
    const out = resizeCrop(half, 'se', 0.1, 0.2)
    expect(out).toEqual(r(0.25, 0.25, 0.6, 0.7))
  })

  it('只拉一邊的時候另外兩邊完全不動 —— 例如只切掉上方的天花板', () => {
    const out = resizeCrop(FULL_CROP, 'n', 0, 0.3)
    expect(out.x).toBe(0)
    expect(out.w).toBe(1)
    expect(out.y).toBeCloseTo(0.3)
    expect(out.h).toBeCloseTo(0.7)
  })
})

describe('邊界', () => {
  it('拉出畫面外會被夾回去', () => {
    expectRect(resizeCrop(half, 'e', 5, 0), r(0.25, 0.25, 0.75, 0.5))
    expectRect(resizeCrop(half, 'w', -5, 0), r(0, 0.25, 0.75, 0.5))
    expect(resizeCrop(half, 's', 0, 5).h).toBeCloseTo(0.75)
    expect(resizeCrop(half, 'n', 0, -5).y).toBe(0)
  })

  it('縮不到比最小邊長更小,而且不會翻面', () => {
    const tiny = resizeCrop(half, 'e', -5, 0)
    expect(tiny.w).toBeCloseTo(MIN_CROP)
    expect(tiny.w).toBeGreaterThan(0)

    // 從左邊往右推過頭:右緣仍釘住,寬度停在最小值
    const fromLeft = resizeCrop(half, 'w', 5, 0)
    expect(fromLeft.w).toBeCloseTo(MIN_CROP)
    expect(fromLeft.x + fromLeft.w).toBeCloseTo(half.x + half.w)
  })

  it('搬移不會把框推出畫面,而且大小不變', () => {
    const moved = resizeCrop(half, 'move', 5, -5)
    expect(moved.w).toBe(half.w)
    expect(moved.h).toBe(half.h)
    expect(moved.x).toBeCloseTo(0.5)
    expect(moved.y).toBe(0)
  })

  it('滿版的框搬不動 —— 沒有空間可以移', () => {
    expect(resizeCrop(FULL_CROP, 'move', 0.3, 0.3)).toEqual(FULL_CROP)
  })
})

describe('鏡像換算', () => {
  it('左右對調,寬度不變', () => {
    expectRect(mirrorCrop(r(0.1, 0.2, 0.3, 0.4)), r(0.6, 0.2, 0.3, 0.4))
  })

  it('做兩次等於沒做 —— 畫面座標與原片座標共用同一支換算', () => {
    const x = r(0.1, 0.2, 0.3, 0.4)
    expectRect(mirrorCrop(mirrorCrop(x)), x)
  })

  it('沒鏡像就原樣回傳', () => {
    const x = r(0.1, 0.2, 0.3, 0.4)
    expect(orientCrop(x, false)).toBe(x)
    expectRect(orientCrop(x, true), mirrorCrop(x))
  })

  it('滿版的框鏡像後還是滿版', () => {
    expectRect(mirrorCrop(FULL_CROP), FULL_CROP)
  })
})

describe('收斂成 null', () => {
  it('等同全畫面就存 null,下游不必處理「裁了但等於沒裁」', () => {
    expect(normaliseCrop(FULL_CROP)).toBeNull()
    expect(isFullCrop(FULL_CROP)).toBe(true)
  })

  it('浮點誤差不會被當成有裁切', () => {
    expect(normaliseCrop(r(1e-9, 0, 1 - 1e-9, 1))).toBeNull()
  })

  it('真的有裁就原樣留著', () => {
    expectRect(normaliseCrop(half)!, half)
    expect(isFullCrop(half)).toBe(false)
  })

  it('拉到底再拉回滿版,會自動回到「沒有裁切」', () => {
    const back = resizeCrop(resizeCrop(FULL_CROP, 'n', 0, 0.3), 'n', 0, -0.3)
    expect(normaliseCrop(back)).toBeNull()
  })
})
