import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FPS,
  chooseOutputFps,
  summariseBlockers,
  summariseTiming,
  type DecodeProbe,
  type FrameTiming,
} from './decodeProbe'

const timing = (over: Partial<FrameTiming> = {}): FrameTiming => ({
  sampled: 300,
  medianDeltaMs: 33.37,
  minDeltaMs: 33.3,
  maxDeltaMs: 33.4,
  fastDeltaMs: 33.35,
  irregularRatio: 0,
  variable: false,
  ...over,
})

const probe = (over: Partial<DecodeProbe> = {}): DecodeProbe => ({
  id: 'a',
  container: 'MP4',
  videoCodec: 'avc',
  audioOnly: false,
  decodable: true,
  reason: null,
  fps: 30,
  timing: timing(),
  ...over,
})

describe('輸出格率', () => {
  it('兩支同格率就直接沿用 —— 取樣點與素材影格一一對應', () => {
    // 都是 24fps 的話輸出也要 24,硬塞 30 會變成 2-3-2-3 的重複/跳格
    const r = chooseOutputFps([probe({ fps: 24 }), probe({ id: 'b', fps: 24 })])
    expect(r).toEqual({ fps: 24, judder: null })
  })

  it('60 與 30 取 60,兩邊都除得盡', () => {
    const r = chooseOutputFps([probe({ fps: 30 }), probe({ id: 'b', fps: 60 })])
    expect(r.fps).toBe(60)
    expect(r.judder).toBeNull()
  })

  it('24 與 30 的最小公倍數太高,退而取高的並說明會頓', () => {
    const r = chooseOutputFps([probe({ fps: 30 }), probe({ id: 'b', fps: 24 })])
    expect(r.fps).toBe(30)
    expect(r.judder).toContain('B')
    expect(r.judder).toContain('24fps')
  })

  it('量不出格率時回到預設值', () => {
    expect(chooseOutputFps([probe({ fps: null })])).toEqual({
      fps: DEFAULT_FPS,
      judder: null,
    })
    expect(chooseOutputFps([])).toEqual({ fps: DEFAULT_FPS, judder: null })
  })

  it('只有一支素材時就用它自己的格率', () => {
    expect(chooseOutputFps([probe({ fps: 25 })]).fps).toBe(25)
  })
})

describe('解碼阻礙', () => {
  it('全部可解時沒有阻礙', () => {
    expect(summariseBlockers([probe(), probe({ id: 'b' })])).toBeNull()
  })

  it('指出是哪一支、為什麼', () => {
    const msg = summariseBlockers([
      probe(),
      probe({ id: 'b', decodable: false, reason: 'HEVC(H.265)—— 解不開' }),
    ])
    expect(msg).toContain('影片 B')
    expect(msg).toContain('HEVC')
    expect(msg).not.toContain('影片 A')
  })

  it('純音檔不算阻礙 —— 畫面走佔位波形,本來就不需要解碼', () => {
    expect(
      summariseBlockers([probe({ audioOnly: true, videoCodec: null, fps: null })]),
    ).toBeNull()
  })
})

const vfrTiming = timing({
  minDeltaMs: 16.7,
  maxDeltaMs: 66.7,
  fastDeltaMs: 16.7,
  irregularRatio: 0.31,
  variable: true,
})

describe('影格時間分佈', () => {
  it('兩支都規則時不出警告', () => {
    expect(summariseTiming([probe(), probe({ id: 'b' })], 30)).toBeNull()
  })

  it('點出是哪一支 VFR,以及間隔跳動的範圍', () => {
    // 名目格率一樣、只有一支是 VFR —— 這正是「只有其中一個影片會頓」的樣子
    const msg = summariseTiming([probe(), probe({ id: 'b', timing: vfrTiming })], 60)
    expect(msg).toContain('影片 B')
    expect(msg).toContain('16.7')
    expect(msg).toContain('31%')
  })

  it('輸出格率接得住最密的影格時,說明已經補償', () => {
    const msg = summariseTiming([probe({ timing: vfrTiming })], 60)
    expect(msg).toContain('已經提高到 60fps')
  })

  it('接不住時要老實說還是會頓,而不是宣稱修好了', () => {
    const msg = summariseTiming([probe({ timing: vfrTiming })], 30)
    expect(msg).toContain('接不住')
    expect(msg).toContain('60fps')
  })

  it('量不出時間分佈就不猜', () => {
    expect(summariseTiming([probe({ timing: null })], 30)).toBeNull()
  })
})

describe('VFR 的輸出格率', () => {
  it('VFR 依最快的瞬時速率提高格率,而不是用平均值', () => {
    // 平均 29.97 但夾著 ~60fps 的影格 —— 用 30 輸出會把那些影格吃掉。
    // 吸附到 59.94 而不是 60:NTSC 的素材本來就是 29.97 / 59.94 這一組
    const r = chooseOutputFps([probe({ fps: 29.97, timing: vfrTiming })])
    expect(r.fps).toBe(59.94)
  })

  it('CFR 不受影響,還是用自己的格率', () => {
    expect(chooseOutputFps([probe({ fps: 29.97 })]).fps).toBe(29.97)
  })
})
