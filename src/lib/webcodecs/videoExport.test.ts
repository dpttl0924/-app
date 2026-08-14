import { describe, expect, it } from 'vitest'
import { planFrameSchedules, summariseFrameStats, type FrameStats } from './videoExport'
import { NO_COUNT_IN, type TimelineMap } from '../timeline'
import type { Clip, ClipId } from '../types'

/**
 * 影格排程的回歸測試。
 *
 * 這裡守的是一件事:送給 `canvasesAtTimestamps()` 的時間戳必須**嚴格遞增**。
 * 不是的話解碼器會對同一個封包重複 seek,實際跑起來就是一句
 * 「Decoding error」,然後整個匯出退回即時錄製。
 */

const clip = (over: Partial<Clip> = {}): Clip => ({
  id: 'a',
  url: 'blob:test',
  name: 'test.mp4',
  durationMs: 60_000,
  width: 1080,
  height: 1920,
  fps: 30,
  offsetMs: 0,
  transform: { scale: 1, offsetX: 0, offsetY: 0, mirrored: false },
  volume: 1,
  envelope: null,
  onset: null,
  ...over,
})

const state = (clips: Partial<Record<ClipId, Clip | null>>) =>
  ({ clips: { a: null, b: null, ...clips } }) as Parameters<typeof planFrameSchedules>[0]

const FRAME_MS = 1000 / 30

const isStrictlyIncreasing = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1])

describe('影格排程', () => {
  it('沒有預備拍時每一格對應一個遞增的時間戳', () => {
    const s = planFrameSchedules(state({ a: clip() }), NO_COUNT_IN, 0, FRAME_MS, 90)

    expect(s.a.timestamps).toHaveLength(90)
    expect(isStrictlyIncreasing(s.a.timestamps)).toBe(true)
    expect(s.a.timestamps[0]).toBeCloseTo(0)
    expect(s.a.covers(0)).toBe(true)
  })

  it('預備拍期間畫面凍結,不重複要求同一個時間戳', () => {
    // 剪輯起點 30s,前面插 4 秒預備拍 —— 那 4 秒內容時間是不動的
    const map: TimelineMap = { countInMs: 4000, countInAtMs: 30_000 }
    const s = planFrameSchedules(state({ a: clip() }), map, 30_000, FRAME_MS, 300)

    expect(isStrictlyIncreasing(s.a.timestamps)).toBe(true)

    // 凍結的 4 秒(120 格)只該解一張,不是 120 張同樣的
    const countInFrames = Math.round(4000 / FRAME_MS)
    const decodesDuringCountIn = s.a.frameIndices.filter((i) => i < countInFrames).length
    expect(decodesDuringCountIn).toBe(1)

    // 但那 120 格畫面仍然要有東西 —— 主迴圈沿用上一張
    expect(s.a.covers(0)).toBe(true)
    expect(s.a.covers(countInFrames - 1)).toBe(true)
  })

  it('素材還沒進場的那幾格不排解碼,也不算 covered', () => {
    // B 從第 2 秒才開始
    const s = planFrameSchedules(
      state({ b: clip({ id: 'b', offsetMs: 2000 }) }),
      NO_COUNT_IN,
      0,
      FRAME_MS,
      90,
    )

    expect(s.b.covers(0)).toBe(false)
    expect(s.b.covers(89)).toBe(true)
    expect(isStrictlyIncreasing(s.b.timestamps)).toBe(true)
  })

  it('素材比輸出範圍短時,結束後不再排解碼', () => {
    const s = planFrameSchedules(
      state({ a: clip({ durationMs: 1000 }) }),
      NO_COUNT_IN,
      0,
      FRAME_MS,
      90,
    )

    expect(s.a.covers(89)).toBe(false)
    expect(Math.max(...s.a.timestamps)).toBeLessThanOrEqual(1)
    expect(isStrictlyIncreasing(s.a.timestamps)).toBe(true)
  })

  it('沒有素材時排程是空的', () => {
    const s = planFrameSchedules(state({}), NO_COUNT_IN, 0, FRAME_MS, 90)
    expect(s.a.timestamps).toHaveLength(0)
    expect(s.b.timestamps).toHaveLength(0)
  })
})

const stats = (over: Partial<FrameStats> = {}): FrameStats => ({
  pulled: 100,
  duplicates: 0,
  skipped: 0,
  missing: 0,
  ...over,
})

describe('影格取用統計', () => {
  it('一格對一格時不回報異常', () => {
    expect(summariseFrameStats({ a: stats(), b: stats() })).toBeNull()
  })

  it('指出是哪一支重複或跳格,以及佔多少比例', () => {
    const msg = summariseFrameStats({
      a: stats(),
      b: stats({ duplicates: 12, skipped: 8 }),
    })
    expect(msg).toContain('影片 B')
    expect(msg).toContain('重複 12')
    expect(msg).toContain('跳格 8')
    expect(msg).toContain('20%')
    expect(msg).not.toContain('影片 A')
  })

  it('缺格只在真的發生時才提', () => {
    expect(summariseFrameStats({ a: stats({ missing: 3 }), b: stats() })).toContain('缺格 3')
    expect(summariseFrameStats({ a: stats({ duplicates: 1 }), b: stats() })).not.toContain('缺格')
  })
})
