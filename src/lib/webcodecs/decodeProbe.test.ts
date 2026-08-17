import { describe, expect, it } from 'vitest'
import {
  summariseBlockers,
  summariseRates,
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

describe('素材格率的說明', () => {
  it('兩支一樣就只是報數字,沒有話要多說', () => {
    const msg = summariseRates([probe(), probe({ id: 'b' })])
    expect(msg).toContain('影片 A 30fps')
    expect(msg).toContain('影片 B 30fps')
    expect(msg).not.toContain('可變格率')
  })

  it('格率不同時說明輸出走可變格率,而不是警告會頓', () => {
    const msg = summariseRates([probe(), probe({ id: 'b', fps: 24 })])
    expect(msg).toContain('24fps')
    expect(msg).toContain('一格對一格')
    expect(msg).not.toContain('頓')
  })

  it('點出哪一支是 VFR', () => {
    const msg = summariseRates([probe(), probe({ id: 'b', timing: vfrTiming })])
    expect(msg).toContain('影片 B 30fps(可變格率)')
    expect(msg).toContain('一格對一格')
  })

  it('量不出格率就不猜', () => {
    expect(summariseRates([probe({ fps: null, timing: null })])).toBeNull()
    expect(summariseRates([])).toBeNull()
  })
})
