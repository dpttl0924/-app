import { beforeEach, describe, expect, it } from 'vitest'
import {
  contentDurationMs,
  countInPlan,
  playRange,
  timelineMap,
  useProject,
  type CountIn,
} from './useProject'
import { projectToContent, relativeToCountIn } from '../lib/timeline'
import { MAX_BPM, MIN_BPM } from '../lib/tempo'
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
    crop: null,
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
    countIn: { enabled: false, bpm: 120, beats: 8, volume: 0.6 },
    tempo: null,
  })
  playbackClock.currentMs = 0
}

const state = () => useProject.getState()
/** 剪輯的保留區間,以內容時間表示(rangeIn / rangeOut 就記在這個座標系) */
const range = () => {
  const s = state()
  const contentMs = contentDurationMs(s)
  const endMs = s.rangeOutMs ?? contentMs
  return { startMs: s.rangeInMs, endMs, durationMs: endMs - s.rangeInMs }
}

describe('預備拍的相位對齊', () => {
  const on = (bpm: number, beats: number): CountIn => ({
    enabled: true,
    bpm,
    beats,
    volume: 0.6,
  })

  it('沒偵測到速度時,就是單純在前面加 N 拍', () => {
    const plan = countInPlan(on(120, 8), 0)
    expect(plan.durationMs).toBeCloseTo(4000) // 8 拍 × 500ms
    expect(plan.clickTimesMs).toHaveLength(8)
    expect(plan.clickTimesMs[0]).toBeCloseTo(0)
    expect(plan.clickTimesMs[7]).toBeCloseTo(3500)
  })

  it('最後一聲 click 落在歌曲第一個重拍的前一拍', () => {
    // 這是整個功能好不好用的關鍵。錯了的話節拍器會跟歌整個錯開。
    const bpm = 110
    const period = 60000 / bpm
    const phase = 320 // 歌曲第一個重拍在內容時間 320ms
    const plan = countInPlan(on(bpm, 8), phase)

    // 第一個重拍在專案時間 = 前綴 + phase
    const firstDownbeat = plan.durationMs + phase
    const lastClick = plan.clickTimesMs[plan.clickTimesMs.length - 1]
    expect(firstDownbeat - lastClick).toBeCloseTo(period, 6)
  })

  it('每一聲 click 都在同一個拍點網格上', () => {
    const bpm = 128
    const period = 60000 / bpm
    const plan = countInPlan(on(bpm, 16), 210)
    for (let i = 1; i < plan.clickTimesMs.length; i++) {
      expect(plan.clickTimesMs[i] - plan.clickTimesMs[i - 1]).toBeCloseTo(period, 6)
    }
  })

  it('相位會讓前綴變短,但第一聲仍然從 0 開始', () => {
    const plan = countInPlan(on(120, 8), 200)
    expect(plan.durationMs).toBeCloseTo(4000 - 200)
    expect(plan.clickTimesMs[0]).toBeCloseTo(0)
    expect(plan.clickTimesMs).toHaveLength(8)
  })

  it('相位大於一拍時只取餘數,不會少掉整個小節', () => {
    const period = 60000 / 120
    const a = countInPlan(on(120, 8), 200)
    const b = countInPlan(on(120, 8), 200 + period * 3)
    expect(b.durationMs).toBeCloseTo(a.durationMs)
    expect(b.clickTimesMs).toHaveLength(8)
  })

  it('關閉時不佔任何時間', () => {
    expect(countInPlan({ ...on(120, 8), enabled: false }, 0)).toEqual({
      durationMs: 0,
      clickTimesMs: [],
    })
  })

  it('拍數選項都算得出對應長度', () => {
    for (const beats of [4, 8, 16]) {
      const plan = countInPlan(on(120, beats), 0)
      expect(plan.clickTimesMs).toHaveLength(beats)
      expect(plan.durationMs).toBeCloseTo(beats * 500)
    }
  })
})

describe('預備拍與時間軸', () => {
  beforeEach(() => load())

  it('開啟預備拍會讓專案變長,但不動任何影片的偏移', () => {
    const before = { a: state().clips.a!.offsetMs, b: state().clips.b!.offsetMs }
    const durationBefore = state().durationMs
    state().setCountIn({ enabled: true, bpm: 120, beats: 8 })
    expect(state().durationMs).toBeCloseTo(durationBefore + 4000)
    expect({ a: state().clips.a!.offsetMs, b: state().clips.b!.offsetMs }).toEqual(before)
  })

  it('關掉之後長度回到原本', () => {
    const durationBefore = state().durationMs
    state().setCountIn({ enabled: true, bpm: 120, beats: 8 })
    state().setCountIn({ enabled: false })
    expect(state().durationMs).toBe(durationBefore)
  })

  it('改拍數會即時反映在專案長度上', () => {
    state().setCountIn({ enabled: true, bpm: 120, beats: 4 })
    const four = state().durationMs
    state().setCountIn({ beats: 16 })
    expect(state().durationMs - four).toBeCloseTo(12 * 500)
  })

  it('先剪輯再開預備拍,預備拍要接在保留的段落前面', () => {
    // 這是回報過的 bug:預備拍原本插在專案時間 0,
    // 剪掉開頭之後就變成加在「被刪掉的那段」前面,離要練的段落還隔著一整段不要的內容
    playheadAt(20_000)
    state().splitAtPlayhead()
    state().deleteSegment('left') // 保留內容 20s 之後

    state().setCountIn({ enabled: true, bpm: 120, beats: 8 }) // 4 秒
    const map = timelineMap(state())
    expect(map.countInAtMs).toBe(20_000)
    // 輸出從 20s 開始,先是 4 秒預備拍,才接內容
    expect(playRange(state()).startMs).toBe(20_000)
    expect(projectToContent(20_000, map)).toBe(20_000) // 預備拍期間內容凍結
    expect(projectToContent(24_000, map)).toBe(20_000) // 預備拍結束,內容正好從保留起點接上
    expect(projectToContent(25_000, map)).toBe(21_000)
  })

  it('迴歸測試:剪過片之後開播,節拍器排程的起算點必須是 0,不是剪輯起點', () => {
    // 這是實際發生過的 bug:useMetronome 曾經直接拿 playbackClock.currentMs
    // (絕對專案時間)跟 plan.durationMs(從 0 起算的預備拍長度)比較。
    // 剪過片後 rangeInMs > 0,播放頭一開始播就已經 >= rangeInMs,
    // 於是「播放頭是否已超過預備拍」的判斷永遠成立,排程被跳過、完全沒聲音。
    playheadAt(20_000)
    state().splitAtPlayhead()
    state().deleteSegment('left') // 保留內容從 20s 開始,rangeInMs = 20000

    state().setCountIn({ enabled: true, bpm: 120, beats: 8 }) // 4 秒預備拍
    const map = timelineMap(state())
    expect(map.countInAtMs).toBe(20_000) // 插入點確實不是 0

    // 模擬 togglePlay():播放頭不在範圍內時會跳到 range.startMs
    const startMs = playRange(state()).startMs
    playbackClock.currentMs = startMs

    // useMetronome 實際使用的換算:必須是 0,才會進入排程分支
    const at = relativeToCountIn(playbackClock.currentMs, map)
    expect(at).toBe(0)
    const plan = countInPlan(state().countIn, state().tempo?.phaseMs ?? 0)
    expect(at).toBeLessThan(plan.durationMs) // 沒有這一步就會被誤判成「已播完預備拍」
  })

  it('開關預備拍不會動到已經剪好的範圍', () => {
    playheadAt(15_000)
    state().splitAtPlayhead()
    state().deleteSegment('left')
    const before = { in: state().rangeInMs, out: state().rangeOutMs }

    state().setCountIn({ enabled: true, bpm: 120, beats: 16 })
    state().setCountIn({ enabled: false })
    expect({ in: state().rangeInMs, out: state().rangeOutMs }).toEqual(before)
  })

  it('BPM 會被夾在合理範圍內', () => {
    state().setCountIn({ bpm: 5 })
    expect(state().countIn.bpm).toBe(MIN_BPM)
    state().setCountIn({ bpm: 9999 })
    expect(state().countIn.bpm).toBe(MAX_BPM)
  })
})

describe('playRange', () => {
  const noCountIn = { enabled: false, bpm: 120, beats: 8, volume: 0.6 }

  it('沒設過範圍時就是整個專案', () => {
    expect(
      playRange({
        rangeInMs: 0,
        rangeOutMs: null,
        durationMs: 30_000,
        countIn: noCountIn,
        tempo: null,
      }),
    ).toEqual({ startMs: 0, endMs: 30_000, durationMs: 30_000 })
  })

  it('rangeOutMs 為 null 代表「到結尾」,載入更長的影片時會自動延伸', () => {
    const at = (durationMs: number) =>
      playRange({
        rangeInMs: 5000,
        rangeOutMs: null,
        durationMs,
        countIn: noCountIn,
        tempo: null,
      })
    expect(at(30_000).endMs).toBe(30_000)
    expect(at(90_000).endMs).toBe(90_000)
  })

  it('輸出範圍從剪輯起點開始 —— 那正是預備拍的開頭', () => {
    // 專案總長 = 內容 30s + 預備拍 4s;保留內容 [10s, 20s]
    const range = playRange({
      rangeInMs: 10_000,
      rangeOutMs: 20_000,
      durationMs: 34_000,
      countIn: { enabled: true, bpm: 120, beats: 8, volume: 0.6 },
      tempo: null,
    })
    expect(range.startMs).toBe(10_000) // 預備拍的開頭
    expect(range.endMs).toBe(24_000) // 保留內容的結尾往後推一個預備拍
    expect(range.durationMs).toBe(14_000) // 4s 預備拍 + 10s 內容
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
