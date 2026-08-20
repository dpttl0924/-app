import { describe, expect, it } from 'vitest'
import { fpsFromFrameTimes, snapToCommonRate } from './frameRate'

/** 從格率反推一串等間隔的呈現時間 */
const evenly = (fps: number, count: number) =>
  Array.from({ length: count }, (_, i) => i / fps)

describe('吸附到常見格率', () => {
  it('量到的小數誤差會被收乾淨', () => {
    expect(snapToCommonRate(29.9993)).toBe(30)
    expect(snapToCommonRate(23.98)).toBe(23.976)
    expect(snapToCommonRate(25.02)).toBe(25)
  })

  it('NTSC 那組不會被吸成整數 —— 29.97 與 30 是不同的東西', () => {
    expect(snapToCommonRate(29.97)).toBe(29.97)
    expect(snapToCommonRate(59.94)).toBe(59.94)
  })

  it('差太遠就相信實測值,不硬套(例如刻意的縮時)', () => {
    expect(snapToCommonRate(15)).toBe(15)
    expect(snapToCommonRate(8)).toBe(8)
  })

  it('量不出來的值一律回傳 null', () => {
    expect(snapToCommonRate(0)).toBeNull()
    expect(snapToCommonRate(-5)).toBeNull()
    expect(snapToCommonRate(NaN)).toBeNull()
    expect(snapToCommonRate(Infinity)).toBeNull()
  })
})

describe('從影格時間推格率', () => {
  it('等間隔就是它的倒數', () => {
    expect(fpsFromFrameTimes(evenly(30, 12))).toBe(30)
    expect(fpsFromFrameTimes(evenly(25, 12))).toBe(25)
    expect(fpsFromFrameTimes(evenly(24, 12))).toBe(24)
  })

  it('開頭幾格不規律不會帶偏結果 —— 用中位數就是為了這個', () => {
    // 解碼器暖機時前兩格間隔異常,其餘正常
    const times = [0, 0.004, 0.2, ...evenly(30, 10).map((t) => t + 0.25)]
    expect(fpsFromFrameTimes(times)).toBe(30)
  })

  it('同一格被回報兩次不算一個間隔', () => {
    const times = [0, 0, 1 / 30, 1 / 30, 2 / 30, 3 / 30, 4 / 30]
    expect(fpsFromFrameTimes(times)).toBe(30)
  })

  it('格數不夠就承認量不出來,不用兩格硬猜', () => {
    expect(fpsFromFrameTimes([])).toBeNull()
    expect(fpsFromFrameTimes([0])).toBeNull()
    expect(fpsFromFrameTimes([0, 1 / 30])).toBeNull()
  })

  it('全部都是同一個時間戳就是 null,不會變成 Infinity', () => {
    expect(fpsFromFrameTimes([0, 0, 0, 0])).toBeNull()
  })

  it('VFR 素材取中位數,得到的是它的主要節奏', () => {
    // 大多是 30fps,夾雜幾個掉格
    const times = [0, 1/30, 2/30, 3/30, 3/30 + 0.1, 3/30 + 0.1 + 1/30, 3/30 + 0.1 + 2/30]
    expect(fpsFromFrameTimes(times)).toBe(30)
  })
})
