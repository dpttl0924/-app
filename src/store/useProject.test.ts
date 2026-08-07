import { beforeEach, describe, expect, it } from 'vitest'
import { playRange, useProject } from './useProject'
import { playbackClock } from '../lib/playbackClock'
import { DEFAULT_TRANSFORM, type Clip, type ClipId } from '../lib/types'

function makeClip(id: ClipId, patch: Partial<Clip> = {}): Clip {
  return {
    id,
    url: `blob:${id}`,
    name: `${id}.mp4`,
    durationMs: 60_000,
    width: 1080,
    height: 1920,
    fps: 30,
    offsetMs: 0,
    transform: { ...DEFAULT_TRANSFORM },
    volume: id === 'a' ? 1 : 0,
    envelope: null,
    onset: null,
    ...patch,
  }
}

function load(a: Partial<Clip> = {}, b: Partial<Clip> = {}) {
  const clips = { a: makeClip('a', a), b: makeClip('b', b) }
  const durationMs = Math.max(
    clips.a.offsetMs + clips.a.durationMs,
    clips.b.offsetMs + clips.b.durationMs,
  )
  useProject.setState({
    clips,
    currentMs: 0,
    durationMs,
    rangeInMs: 0,
    rangeOutMs: null,
    playing: false,
  })
  playbackClock.currentMs = 0
}

const state = () => useProject.getState()
const range = () => playRange(state())

describe('playRange', () => {
  it('沒設過範圍時就是整個專案', () => {
    expect(playRange({ rangeInMs: 0, rangeOutMs: null, durationMs: 30_000 })).toEqual({
      startMs: 0,
      endMs: 30_000,
      durationMs: 30_000,
    })
  })

  it('rangeOutMs 為 null 代表「到結尾」,載入更長的影片時會自動延伸', () => {
    const before = playRange({ rangeInMs: 5000, rangeOutMs: null, durationMs: 30_000 })
    const after = playRange({ rangeInMs: 5000, rangeOutMs: null, durationMs: 90_000 })
    expect(before.endMs).toBe(30_000)
    expect(after.endMs).toBe(90_000)
  })
})

describe('輸出範圍', () => {
  beforeEach(() => load())

  it('設定範圍不會動到任何一支影片的偏移', () => {
    // 這正是每支影片各自裁切的做法會出錯的地方 —— 對齊好的東西不該被剪輯動到
    const before = { a: state().clips.a!.offsetMs, b: state().clips.b!.offsetMs }
    state().setRange({ inMs: 8000, outMs: 20_000 })
    expect({ a: state().clips.a!.offsetMs, b: state().clips.b!.offsetMs }).toEqual(before)
  })

  it('範圍長度就是匯出長度', () => {
    state().setRange({ inMs: 8000, outMs: 20_000 })
    expect(range().durationMs).toBe(12_000)
  })

  it('專案總長度不受範圍影響,裁掉的部分還看得到也拉得回來', () => {
    state().setRange({ inMs: 8000, outMs: 20_000 })
    expect(state().durationMs).toBe(60_000)
  })

  it('訖點設在結尾時記成 null,之後換更長的影片會自動延伸', () => {
    state().setRange({ outMs: 60_000 })
    expect(state().rangeOutMs).toBeNull()
  })

  it('拒絕把範圍縮到幾乎為零', () => {
    state().setRange({ inMs: 10_000, outMs: 10_050 })
    expect(range().startMs).toBe(0)
    expect(range().endMs).toBe(60_000)
  })

  it('起訖點會被夾在專案長度內', () => {
    state().setRange({ inMs: -5000, outMs: 999_000 })
    expect(range().startMs).toBe(0)
    expect(range().endMs).toBe(60_000)
  })

  it('全選會還原成整個專案', () => {
    state().setRange({ inMs: 8000, outMs: 20_000 })
    state().clearRange()
    expect(range()).toEqual({ startMs: 0, endMs: 60_000, durationMs: 60_000 })
  })

  it('起點設為現在讀的是時鐘,不是 10Hz 的節流鏡像', () => {
    // store.currentMs 播放中最多會落後 100ms,拿它當裁切點等於差三格
    playbackClock.currentMs = 12_345
    useProject.setState({ currentMs: 12_000 })
    state().setRangeToPlayhead('in')
    expect(state().rangeInMs).toBe(12_345)
  })
})

describe('播放與輸出範圍的互動', () => {
  beforeEach(() => load())

  it('播放頭在範圍前面時,按播放會跳到範圍開頭', () => {
    // 不這樣做的話按下播放會立刻又停住,看起來像壞掉
    state().setRange({ inMs: 10_000, outMs: 20_000 })
    state().seek(2000)
    state().togglePlay()
    expect(state().playing).toBe(true)
    expect(playbackClock.currentMs).toBe(10_000)
  })

  it('播放頭停在範圍結尾時,按播放會從頭再來', () => {
    state().setRange({ inMs: 10_000, outMs: 20_000 })
    state().seek(20_000)
    state().togglePlay()
    expect(playbackClock.currentMs).toBe(10_000)
  })

  it('播放頭已經在範圍內時,從原地繼續播', () => {
    state().setRange({ inMs: 10_000, outMs: 20_000 })
    state().seek(15_000)
    state().togglePlay()
    expect(playbackClock.currentMs).toBe(15_000)
  })

  it('可以把播放頭拖到範圍外去調整起訖點', () => {
    state().setRange({ inMs: 10_000, outMs: 20_000 })
    state().seek(45_000)
    expect(state().currentMs).toBe(45_000)
  })
})

describe('applyLag', () => {
  beforeEach(() => load())

  it('偏移量就是對齊算出來的 lag', () => {
    state().applyLag(2500)
    expect(state().clips.b!.offsetMs - state().clips.a!.offsetMs).toBe(2500)
  })

  it('負的 lag 代表 A 才是晚開始的那段', () => {
    state().applyLag(-3200)
    expect(state().clips.a!.offsetMs).toBe(3200)
    expect(state().clips.b!.offsetMs).toBe(0)
  })

  it('設過輸出範圍之後,自動對齊的結果不受影響', () => {
    // 範圍是專案層級的,不參與 offset 計算,所以對齊公式維持最單純的形式
    state().setRange({ inMs: 5000, outMs: 30_000 })
    state().applyLag(2500)
    expect(state().clips.b!.offsetMs - state().clips.a!.offsetMs).toBe(2500)
  })
})
