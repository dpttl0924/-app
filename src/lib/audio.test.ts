import { describe, expect, it } from 'vitest'
import { alignOnsets } from './audio'
import { ENVELOPE_HZ } from './types'

/**
 * 互相關最容易錯的地方是正負號 —— 算出 2.5 秒但方向反了,兩段影片會差 5 秒,
 * 而且畫面上看起來「有動」很容易誤以為對了。
 * 這裡用合成資料把 lagMs 的定義釘死:lagMs === offsetB - offsetA。
 */

/**
 * 造一段假的起音包絡:每 0.5 秒一個拍點,但每一拍的力度都不同。
 *
 * 「力度不同」這件事很關鍵。真實歌曲的節奏雖然重複,但人聲、過門、混音變化
 * 讓每個小節的能量輪廓都不一樣,互相關才有唯一解。
 * 嚴格週期的訊號(例如節拍器)反而是最難的情況 —— 見下面的 hasAlternative 測試。
 */
function makeOnset(lengthSamples: number, seed = 1): Float32Array {
  const out = new Float32Array(lengthSamples)
  const next = lcg(seed)
  const beat = Math.round(ENVELOPE_HZ * 0.5)
  for (let i = 0; i < lengthSamples; i++) {
    if (i % beat === 0) out[i] = 0.35 + next() * 0.65
    else if (i % beat === 1) out[i] = next() * 0.3
    out[i] += next() * 0.02
  }
  return out
}

/** 嚴格週期的節拍器訊號:每一拍完全一樣,沒有任何線索能分辨小節 */
function makeClickTrack(lengthSamples: number): Float32Array {
  const out = new Float32Array(lengthSamples)
  const beat = Math.round(ENVELOPE_HZ * 0.5)
  for (let i = 0; i < lengthSamples; i++) out[i] = i % beat === 0 ? 1 : 0
  return out
}

/** out[t] = src[t + shift],也就是「晚 shift 個取樣點才開始錄」的那一段 */
function shiftBy(src: Float32Array, shift: number): Float32Array {
  const out = new Float32Array(src.length - shift)
  for (let t = 0; t < out.length; t++) out[t] = src[t + shift]
  return out
}

/** 加雜訊 + 整體音量縮放,模擬兩台不同裝置的錄音 */
function degrade(src: Float32Array, gain: number, noise: number, seed = 7): Float32Array {
  const next = lcg(seed)
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = src[i] * gain + next() * noise
  return out
}

function lcg(seed: number) {
  let rnd = seed
  return () => {
    rnd = (rnd * 1103515245 + 12345) & 0x7fffffff
    return rnd / 0x7fffffff
  }
}

const sec = (n: number) => Math.round(ENVELOPE_HZ * n)

describe('alignOnsets', () => {
  it('乾淨訊號:B 晚 2.5 秒開始,應算出 +2500ms', () => {
    const base = makeOnset(sec(60))
    const { lagMs, score, hasAlternative } = alignOnsets(base, shiftBy(base, sec(2.5)))
    expect(lagMs).toBeCloseTo(2500, -1)
    expect(score).toBeGreaterThan(0.9)
    expect(hasAlternative).toBe(false)
  })

  it('反方向:A 才是晚開始的那段,應算出負值', () => {
    const base = makeOnset(sec(60))
    const { lagMs } = alignOnsets(shiftBy(base, sec(3.2)), base)
    expect(lagMs).toBeCloseTo(-3200, -1)
  })

  it('本來就對齊的兩段,應回傳 0', () => {
    const base = makeOnset(sec(45))
    const { lagMs } = alignOnsets(base, degrade(base, 1, 0.01, 99))
    expect(Math.abs(lagMs)).toBeLessThan(20)
  })

  it('音量差 3 倍加雜訊仍能對齊(對數壓縮 + Pearson 正規化的效果)', () => {
    const base = makeOnset(sec(90))
    const a = degrade(base, 1.0, 0.05, 3)
    const b = degrade(shiftBy(base, sec(7.4)), 0.35, 0.05, 11)
    const { lagMs, score, hasAlternative } = alignOnsets(a, b)
    expect(lagMs).toBeCloseTo(7400, -2)
    expect(score).toBeGreaterThan(0.8)
    expect(hasAlternative).toBe(false)
  })

  it('雜訊蓋過訊號時,必須標記 hasAlternative 而不是給錯誤答案', () => {
    const base = makeOnset(sec(90))
    const a = degrade(base, 1, 0.02, 3)
    const b = degrade(shiftBy(base, sec(4)), 1, 1.2, 21)
    expect(alignOnsets(a, b).hasAlternative).toBe(true)
  })

  it('嚴格週期的節拍器:score 滿分也要交出另一個候選', () => {
    const click = makeClickTrack(sec(60))
    const result = alignOnsets(click, shiftBy(click, sec(2.5)))
    // 每個小節都完美吻合,所以 score 是滿分 —— 這正是危險之處。
    // 分數再高也不代表對到正確的小節,唯一能做的是把其他候選位置一起交出去。
    expect(result.score).toBeGreaterThan(0.9)
    expect(result.hasAlternative).toBe(true)
  })

  it('振幅變化豐富的訊號,主峰應該明顯領先,不需要提供替代選項', () => {
    const base = makeOnset(sec(90))
    const result = alignOnsets(base, shiftBy(base, sec(4)))
    expect(result.hasAlternative).toBe(false)
  })

  it('兩首無關的歌:score 高得嚇人,證明它不能單獨當判準', () => {
    const a = makeOnset(sec(90), 1)
    const b = makeOnset(sec(90), 999)
    const result = alignOnsets(a, b)
    // 兩首同 BPM 的歌,拍點位置本來就對得上,實測 score 到 0.93。
    // 這個測試存在的意義就是釘住這個反直覺的事實 —— 不要再想用 score 當可信度。
    expect(result.score).toBeGreaterThan(0.8)
    expect(result.hasAlternative).toBe(true)
  })

  it('重疊太少時應該拒絕作答,而不是硬給一個答案', () => {
    const a = makeOnset(sec(60))
    const b = makeOnset(sec(3), 42) // 只有 3 秒,低於 5 秒的最小重疊要求
    expect(() => alignOnsets(a, b)).toThrow()
  })

  it('3 分鐘音訊要在 100ms 內算完(FFT 而非 O(n²) 的意義)', () => {
    const a = makeOnset(sec(180))
    const b = shiftBy(a, sec(5))
    const t0 = performance.now()
    alignOnsets(a, b)
    expect(performance.now() - t0).toBeLessThan(100)
  })
})
