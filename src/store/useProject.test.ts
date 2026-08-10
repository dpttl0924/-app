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

/** 把播放頭移到某個時間(同時更新時鐘,模擬真實操作) */
function playheadAt(ms: number) {
  state().seek(ms)
}

/** 用「切開 → 刪掉不要的那邊」剪出一段,也就是使用者實際會做的操作 */
function trimTo(startMs: number, endMs: number) {
  playheadAt(startMs)
  state().splitAtPlayhead()
  state().deleteSegment('left')
  playheadAt(endMs)
  state().splitAtPlayhead()
  state().deleteSegment('right')
}

describe('切開與刪除', () => {
  beforeEach(() => load())

  it('切開後刪掉左邊,保留的是右半段', () => {
    playheadAt(20_000)
    state().splitAtPlayhead()
    state().deleteSegment('left')
    expect(range()).toEqual({ startMs: 20_000, endMs: 60_000, durationMs: 40_000 })
  })

  it('切開後刪掉右邊,保留的是左半段', () => {
    playheadAt(20_000)
    state().splitAtPlayhead()
    state().deleteSegment('right')
    expect(range()).toEqual({ startMs: 0, endMs: 20_000, durationMs: 20_000 })
  })

  it('可以連續切,一次切掉頭、一次切掉尾', () => {
    playheadAt(10_000)
    state().splitAtPlayhead()
    state().deleteSegment('left')
    playheadAt(40_000)
    state().splitAtPlayhead()
    state().deleteSegment('right')
    expect(range()).toEqual({ startMs: 10_000, endMs: 40_000, durationMs: 30_000 })
  })

  it('剪輯完全不會動到任何一支影片的偏移', () => {
    // 這正是每支影片各自裁切的舊做法會出錯的地方 —— 對齊好的東西不該被剪輯動到
    const before = { a: state().clips.a!.offsetMs, b: state().clips.b!.offsetMs }
    playheadAt(20_000)
    state().splitAtPlayhead()
    state().deleteSegment('left')
    expect({ a: state().clips.a!.offsetMs, b: state().clips.b!.offsetMs }).toEqual(before)
  })

  it('專案總長度不受剪輯影響,刪掉的部分還原得回來', () => {
    playheadAt(20_000)
    state().splitAtPlayhead()
    state().deleteSegment('left')
    expect(state().durationMs).toBe(60_000)
  })

  it('切在保留區間的邊界上不算切開', () => {
    playheadAt(0)
    state().splitAtPlayhead()
    expect(state().splitAtMs).toBeNull()

    playheadAt(60_000)
    state().splitAtPlayhead()
    expect(state().splitAtMs).toBeNull()
  })

  it('切點只能落在還沒被刪掉的範圍內', () => {
    playheadAt(30_000)
    state().splitAtPlayhead()
    state().deleteSegment('left') // 保留 30s–60s
    playheadAt(10_000) // 這裡已經被刪掉了
    state().splitAtPlayhead()
    expect(state().splitAtMs).toBeNull()
  })

  it('刪到只剩一點點會被擋下來', () => {
    playheadAt(59_950)
    state().splitAtPlayhead()
    state().deleteSegment('left') // 只會剩 50ms
    expect(range().startMs).toBe(0)
  })

  it('切點讀的是時鐘,不是 10Hz 的節流鏡像', () => {
    // store.currentMs 播放中最多會落後 100ms,拿它當切點等於差三格
    playbackClock.currentMs = 12_345
    useProject.setState({ currentMs: 12_000 })
    state().splitAtPlayhead()
    expect(state().splitAtMs).toBe(12_345)
  })

  it('取消切開不會留下任何痕跡', () => {
    playheadAt(20_000)
    state().splitAtPlayhead()
    state().cancelSplit()
    expect(state().splitAtMs).toBeNull()
    expect(range().durationMs).toBe(60_000)
  })

  it('播放頭落在被刪掉的那段時,會移到剩下這段的開頭', () => {
    playheadAt(20_000)
    state().splitAtPlayhead()
    playheadAt(5000) // 移到即將被刪掉的左半段
    state().deleteSegment('left')
    expect(playbackClock.currentMs).toBe(20_000)
  })
})

describe('復原', () => {
  beforeEach(() => load())

  it('刪掉之後可以復原', () => {
    playheadAt(20_000)
    state().splitAtPlayhead()
    state().deleteSegment('left')
    state().undoTrim()
    expect(range()).toEqual({ startMs: 0, endMs: 60_000, durationMs: 60_000 })
  })

  it('沒有可復原的東西時按了也不會壞', () => {
    state().undoTrim()
    expect(range().durationMs).toBe(60_000)
  })

  it('還原成完整長度之後,也可以再復原回剪過的狀態', () => {
    playheadAt(20_000)
    state().splitAtPlayhead()
    state().deleteSegment('right')
    state().clearRange()
    expect(range().durationMs).toBe(60_000)
    state().undoTrim()
    expect(range().endMs).toBe(20_000)
  })

  it('訖點就是專案結尾時記成 null,之後換更長的影片會自動延伸', () => {
    playheadAt(20_000)
    state().splitAtPlayhead()
    state().deleteSegment('left')
    expect(state().rangeOutMs).toBeNull()
  })
})

describe('播放與輸出範圍的互動', () => {
  beforeEach(() => load())

  it('播放頭在範圍前面時,按播放會跳到範圍開頭', () => {
    // 不這樣做的話按下播放會立刻又停住,看起來像壞掉
    trimTo(10_000, 20_000)
    state().seek(2000)
    state().togglePlay()
    expect(state().playing).toBe(true)
    expect(playbackClock.currentMs).toBe(10_000)
  })

  it('播放頭停在範圍結尾時,按播放會從頭再來', () => {
    trimTo(10_000, 20_000)
    state().seek(20_000)
    state().togglePlay()
    expect(playbackClock.currentMs).toBe(10_000)
  })

  it('播放頭已經在範圍內時,從原地繼續播', () => {
    trimTo(10_000, 20_000)
    state().seek(15_000)
    state().togglePlay()
    expect(playbackClock.currentMs).toBe(15_000)
  })

  it('可以把播放頭拖到範圍外去調整起訖點', () => {
    trimTo(10_000, 20_000)
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

  it('剪輯過之後,自動對齊的結果不受影響', () => {
    // 剪輯是專案層級的,不參與 offset 計算,所以對齊公式維持最單純的形式
    trimTo(5000, 30_000)
    state().applyLag(2500)
    expect(state().clips.b!.offsetMs - state().clips.a!.offsetMs).toBe(2500)
  })
})
