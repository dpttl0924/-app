import { describe, expect, it } from 'vitest'
import type { WrappedCanvas } from 'mediabunny'
import {
  MAX_FRAME_MS,
  composeTimeline,
  frameProjectMs,
  type CompositeFrame,
  type CompositeTrack,
} from './composite'
import type { FrameSource } from './frameSource'
import { NO_COUNT_IN, type TimelineMap } from '../timeline'
import type { Clip, ClipId } from '../types'

/**
 * 合成時間軸的回歸測試。
 *
 * 守的是這條路徑存在的理由:**兩支素材的每一張影格都要剛好出現一次**。
 * 少出現(跳格)或多出現(重複)就是畫面在頓 —— 舊版固定格率的做法在
 * 兩支格率不同時必然會有一支中招,那正是這裡要擋住的回歸。
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

/**
 * 假的影格來源。canvas 直接放一個字串標籤,才能斷言「這一格畫的是哪一張」。
 */
function fakeSource(frames: { timestamp: number; duration: number }[]): FrameSource {
  let i = 0
  return {
    next: async () => {
      if (i >= frames.length) return null
      const f = frames[i++]
      return {
        canvas: `${f.timestamp.toFixed(4)}` as unknown as HTMLCanvasElement,
        timestamp: f.timestamp,
        duration: f.duration,
      } satisfies WrappedCanvas
    },
    dispose: async () => {},
  }
}

/** 固定格率的素材:第一張在 fromSec,共 count 張 */
const cfr = (fps: number, count: number, fromSec = 0) =>
  Array.from({ length: count }, (_, i) => ({
    timestamp: fromSec + i / fps,
    duration: 1 / fps,
  }))

const track = (
  id: ClipId,
  frames: { timestamp: number; duration: number }[],
  over: Partial<Clip> = {},
): CompositeTrack => ({
  id,
  clip: clip({ id, ...over }),
  source: fakeSource(frames),
  used: 0,
})

async function collect(
  tracks: CompositeTrack[],
  map: TimelineMap,
  startMs: number,
  endMs: number,
): Promise<CompositeFrame[]> {
  const out: CompositeFrame[] = []
  for await (const f of composeTimeline(tracks, map, startMs, endMs)) out.push(f)
  return out
}

/** 某一支素材在整段輸出裡實際被畫出來的畫面,連續重複的算一次 */
const shownSequence = (frames: CompositeFrame[], id: ClipId): string[] => {
  const out: string[] = []
  for (const f of frames) {
    const label = f.sources[id] as unknown as string | null
    if (label !== null && label !== out[out.length - 1]) out.push(label)
  }
  return out
}

describe('合成時間軸', () => {
  it('單支素材:合成的時刻就是它自己的影格時刻', async () => {
    const t = track('a', cfr(30, 30))
    const frames = await collect([t], NO_COUNT_IN, 0, 1000)

    expect(frames).toHaveLength(30)
    expect(t.used).toBe(30)
    expect(frames[1].atMs).toBeCloseTo(1000 / 30)
    expect(frames[0].durationMs).toBeCloseTo(1000 / 30)
  })

  it('格率不同時兩支都是一格對一格 —— 這是舊版做不到的那件事', async () => {
    // 30fps 的手機影片配 24fps 的網路影片。舊版固定 30fps 輸出,
    // 24fps 那支每秒有 6 張要重複 —— 就是「其中一支會頓」。
    const a = track('a', cfr(30, 30))
    const b = track('b', cfr(24, 24))
    const frames = await collect([a, b], NO_COUNT_IN, 0, 1000)

    expect(a.used).toBe(30)
    expect(b.used).toBe(24)
    // 每一張都出現過,而且順序沒亂、沒有哪一張被切成兩段
    expect(shownSequence(frames, 'a')).toHaveLength(30)
    expect(shownSequence(frames, 'b')).toHaveLength(24)
  })

  it('25 配 30 也一樣,兩支的張數都完整', async () => {
    const a = track('a', cfr(30, 30))
    const b = track('b', cfr(25, 25))
    const frames = await collect([a, b], NO_COUNT_IN, 0, 1000)

    expect(shownSequence(frames, 'a')).toHaveLength(30)
    expect(shownSequence(frames, 'b')).toHaveLength(25)
  })

  it('VFR 素材的不規則間隔原樣保留,不被量化到網格上', async () => {
    // 間隔在 16.7 與 50ms 之間跳動 —— 手機錄影很常這樣
    const deltas = [0, 16.7, 66.7, 83.4, 133.4, 150.1]
    const b = track(
      'b',
      deltas.map((ms, i) => ({
        timestamp: ms / 1000,
        duration: ((deltas[i + 1] ?? ms + 33.3) - ms) / 1000,
      })),
    )
    const frames = await collect([b], NO_COUNT_IN, 0, 200)

    expect(b.used).toBe(deltas.length)
    for (const [i, ms] of deltas.entries()) {
      expect(frames[i].atMs).toBeCloseTo(ms, 1)
    }
  })

  it('同格率、次格級的對齊偏移會被併掉,不會讓格數翻倍', async () => {
    // 兩支都是 30fps,B 晚 5ms。那 5ms 是固定相位差,不是節奏不對 ——
    // 為它多產生一倍的格數只是浪費編碼時間。
    const a = track('a', cfr(30, 30))
    const b = track('b', cfr(30, 30), { offsetMs: 5 })
    const frames = await collect([a, b], NO_COUNT_IN, 0, 1000)

    expect(frames.length).toBeLessThanOrEqual(31)
    expect(a.used).toBe(30)
    expect(b.used).toBe(30)
  })

  it('偏移大到超過四分之一格就各自佔一刻,寧可多幾格也不動到節奏', async () => {
    const a = track('a', cfr(30, 30))
    const b = track('b', cfr(30, 30), { offsetMs: 16 })
    const frames = await collect([a, b], NO_COUNT_IN, 0, 1000)

    expect(frames.length).toBeGreaterThan(50)
    expect(shownSequence(frames, 'a')).toHaveLength(30)
    expect(shownSequence(frames, 'b')).toHaveLength(30)
  })

  it('預備拍期間畫面凍結,但一格不會長達好幾秒', async () => {
    // 剪輯起點 30s,前面插 4 秒預備拍
    const map: TimelineMap = { countInMs: 4000, countInAtMs: 30_000 }
    // 覆蓋起點的那一張(29.9667s)加上後續
    const a = track('a', cfr(30, 60, 29.9667))
    const frames = await collect([a], map, 30_000, 35_000)

    const countIn = frames.filter((f) => f.atMs < 34_000)
    expect(countIn.length).toBeGreaterThan(30)
    for (const f of countIn) {
      // 凍結期間畫面不能是空的,而且不能一格撐完整段預備拍
      expect(f.sources.a).not.toBeNull()
      expect(f.durationMs).toBeLessThanOrEqual(MAX_FRAME_MS)
    }
    // 凍結的 4 秒只用掉起點那一張
    expect(shownSequence(countIn, 'a')).toHaveLength(1)
  })

  it('素材播完之後不留殘影', async () => {
    const a = track('a', cfr(30, 15), { durationMs: 500 })
    const frames = await collect([a], NO_COUNT_IN, 0, 1000)

    expect(frames[0].sources.a).not.toBeNull()
    expect(frames[frames.length - 1].sources.a).toBeNull()
  })

  it('還沒進場的素材不會提早出現', async () => {
    const b = track('b', cfr(30, 30, 0), { offsetMs: 500 })
    const frames = await collect([b], NO_COUNT_IN, 0, 1000)

    expect(frames[0].sources.b).toBeNull()
    expect(frames[frames.length - 1].sources.b).not.toBeNull()
  })

  it('時刻嚴格遞增,長度都大於零,加起來剛好是輸出長度', async () => {
    const a = track('a', cfr(30, 30))
    const b = track('b', cfr(24, 24))
    const frames = await collect([a, b], NO_COUNT_IN, 0, 1000)

    for (const [i, f] of frames.entries()) {
      expect(f.durationMs).toBeGreaterThan(0)
      if (i > 0) expect(f.atMs).toBeGreaterThan(frames[i - 1].atMs)
    }
    const last = frames[frames.length - 1]
    expect(last.atMs + last.durationMs).toBeCloseTo(1000)
  })

  it('一支視訊軌都沒有時仍然照最低 cadence 產出 —— 純音檔要畫波形佔位', async () => {
    const frames = await collect([], NO_COUNT_IN, 0, 1000)

    expect(frames).toHaveLength(1000 / MAX_FRAME_MS)
    expect(frames.every((f) => f.durationMs === MAX_FRAME_MS)).toBe(true)
  })

  it('範圍是空的時候也不產出', async () => {
    const a = track('a', cfr(30, 30))
    expect(await collect([a], NO_COUNT_IN, 500, 500)).toHaveLength(0)
  })
})

describe('影格落在專案時間軸的哪一刻', () => {
  it('加上這支素材自己的對齊偏移', () => {
    expect(frameProjectMs(clip({ offsetMs: 200 }), 1, NO_COUNT_IN, 0)).toBeCloseTo(1200)
  })

  it('跳過預備拍那一段', () => {
    const map: TimelineMap = { countInMs: 4000, countInAtMs: 1000 }
    expect(frameProjectMs(clip(), 2, map, 1000)).toBeCloseTo(6000)
  })

  it('剪輯起點之前的那一張夾到起點 —— 它是預備拍期間要凍住的畫面', () => {
    const map: TimelineMap = { countInMs: 4000, countInAtMs: 1000 }
    expect(frameProjectMs(clip(), 0.9667, map, 1000)).toBe(1000)
    expect(frameProjectMs(clip(), 1, map, 1000)).toBe(1000)
  })
})
