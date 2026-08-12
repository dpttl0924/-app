import { describe, expect, it } from 'vitest'
import { MIN_CONFIDENCE, detectTempo } from './tempo'
import { ENVELOPE_HZ } from './types'

function lcg(seed: number) {
  let r = seed
  return () => {
    r = (r * 1103515245 + 12345) & 0x7fffffff
    return r / 0x7fffffff
  }
}

/**
 * 造一段起音包絡:固定 BPM 的拍點,每拍力度不同(真實歌曲不會每拍一樣重)。
 * @param phaseSec 第一個拍點落在第幾秒
 */
function beats(
  seconds: number,
  bpm: number,
  { phaseSec = 0, noise = 0, seed = 1, accentEvery = 0 } = {},
): Float32Array {
  const n = Math.round(seconds * ENVELOPE_HZ)
  const out = new Float32Array(n)
  const next = lcg(seed)
  const period = (60 / bpm) * ENVELOPE_HZ
  for (let k = 0; k * period + phaseSec * ENVELOPE_HZ < n; k++) {
    const i = Math.round(k * period + phaseSec * ENVELOPE_HZ)
    if (i < 0 || i >= n) continue
    let amp = 0.45 + 0.55 * next()
    // accentEvery > 0:每 N 拍才是重拍,其餘弱拍。用來測八度誤判。
    if (accentEvery > 0 && k % accentEvery !== 0) amp *= 0.35
    out[i] = amp
  }
  if (noise > 0) {
    const nz = lcg(seed + 77)
    for (let i = 0; i < n; i++) out[i] += nz() * noise
  }
  return out
}

describe('detectTempo', () => {
  it.each([90, 100, 110, 120, 128, 140, 160])('測得出 %i BPM', (bpm) => {
    const { bpm: got } = detectTempo(beats(60, bpm))
    expect(got).toBeCloseTo(bpm, 0)
  })

  it('拋物線內插讓精度好過 100Hz 包絡的格點', () => {
    // 不內插的話,120 BPM 附近一格就差 2.4 BPM
    const { bpm } = detectTempo(beats(60, 113))
    expect(Math.abs(bpm - 113)).toBeLessThan(1)
  })

  it('有雜訊時仍然測得準', () => {
    const { bpm } = detectTempo(beats(60, 128, { noise: 0.25, seed: 5 }))
    expect(bpm).toBeCloseTo(128, 0)
  })

  it('每四拍才一個重拍時,不會被誤判成 1/4 速', () => {
    // 這是八度誤判最典型的來源:自相關在 4 倍週期同樣有強峰值
    const { bpm } = detectTempo(beats(60, 128, { accentEvery: 4 }))
    expect(bpm).toBeGreaterThan(100)
    expect(bpm).toBeLessThan(160)
  })

  it('相位:第一個拍點的位置要抓得出來', () => {
    const period = (60 / 120) * 1000 // 500ms
    const { phaseMs, beatPeriodMs } = detectTempo(beats(60, 120, { phaseSec: 0.18 }))
    expect(beatPeriodMs).toBeCloseTo(period, 0)
    // 相位是週期的餘數,180ms 和 180+500ms 是同一件事
    const err = Math.min(
      Math.abs(phaseMs - 180),
      Math.abs(phaseMs - 180 + period),
      Math.abs(phaseMs - 180 - period),
    )
    expect(err).toBeLessThan(25)
  })

  it('相位為零時也回報接近零', () => {
    const { phaseMs, beatPeriodMs } = detectTempo(beats(60, 110))
    const err = Math.min(phaseMs, Math.abs(phaseMs - beatPeriodMs))
    expect(err).toBeLessThan(25)
  })

  it('beatPeriodMs 與 bpm 必須自洽', () => {
    const t = detectTempo(beats(60, 137))
    expect(t.beatPeriodMs).toBeCloseTo(60000 / t.bpm, 3)
  })

  it.each([
    ['三次方稀疏雜訊', 999, 3],
    ['均勻白雜訊', 424242, 1],
    ['另一組雜訊', 7, 3],
  ])('沒有節奏的訊號(%s)信心度必須低於門檻', (_name, seed, power) => {
    const next = lcg(seed)
    const n = ENVELOPE_HZ * 60
    const noise = new Float32Array(n)
    for (let i = 0; i < n; i++) noise[i] = next() ** power
    expect(detectTempo(noise).confidence).toBeLessThan(MIN_CONFIDENCE)
  })

  it('白雜訊的 margin 可以很高,所以不能只看 margin', () => {
    // 這是踩過的坑:雜訊的所有分數都趨近 0,隨機的最大值除以次大值
    // 照樣得到 0.8 的漂亮比例 —— 比值型指標在分母很小時會爆掉。
    // strength 是絕對量,才擋得住。
    const next = lcg(424242)
    const n = ENVELOPE_HZ * 60
    const noise = new Float32Array(n)
    for (let i = 0; i < n; i++) noise[i] = next()
    const r = detectTempo(noise)
    expect(r.margin).toBeGreaterThan(0.5)
    expect(r.strength).toBeLessThan(0.15)
    expect(r.confidence).toBeLessThan(MIN_CONFIDENCE)
  })

  it.each([
    ['乾淨', {}],
    ['輕微雜訊', { noise: 0.2, seed: 5 }],
    ['每四拍一個重拍', { accentEvery: 4 }],
  ])('抓得到拍子時(%s)信心度要高於門檻', (_name, opts) => {
    expect(detectTempo(beats(60, 128, opts)).confidence).toBeGreaterThan(MIN_CONFIDENCE)
  })

  it('音訊太短時明講,不要硬給一個數字', () => {
    expect(() => detectTempo(beats(5, 120))).toThrow()
  })
})
