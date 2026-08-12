import { describe, expect, it } from 'vitest'
import { envelopeToBars } from './audioPreview'

describe('envelopeToBars', () => {
  it('空包絡回傳空陣列', () => {
    expect(envelopeToBars(new Float32Array(0), 10)).toEqual([])
  })

  it('barCount 是 0 或負數時回傳空陣列', () => {
    expect(envelopeToBars(Float32Array.from([1, 2, 3]), 0)).toEqual([])
    expect(envelopeToBars(Float32Array.from([1, 2, 3]), -1)).toEqual([])
  })

  it('全零的包絡回傳全零的長條,不會除以零變成 NaN', () => {
    const bars = envelopeToBars(new Float32Array(50), 5)
    expect(bars).toEqual([0, 0, 0, 0, 0])
  })

  it('正規化到 0..1,最大值那一格是 1', () => {
    const env = Float32Array.from([0.2, 0.8, 0.4, 0.1])
    const bars = envelopeToBars(env, 4)
    expect(Math.max(...bars)).toBeCloseTo(1)
    expect(bars.every((b) => b >= 0 && b <= 1)).toBe(true)
  })

  it('取峰值而不是平均 —— 單一個尖峰不會被同一格裡的其他樣本稀釋', () => {
    // 10 個樣本壓成 1 格,裡面只有一個尖峰,取峰值應該完整保留這個尖峰
    const env = new Float32Array(10)
    env[7] = 1
    const bars = envelopeToBars(env, 1)
    expect(bars[0]).toBeCloseTo(1)
  })

  it('每一格對應到不重疊的來源範圍,長條數等於要求的數量', () => {
    const env = new Float32Array(97) // 刻意用不好整除的長度
    env[0] = 1
    env[96] = 0.5
    const bars = envelopeToBars(env, 20)
    expect(bars).toHaveLength(20)
    expect(bars[0]).toBeCloseTo(1) // 第一個樣本落在第一格
    expect(bars[19]).toBeGreaterThan(0) // 最後一個樣本落在最後一格
  })
})
