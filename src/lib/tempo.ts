import { standardize } from './audio'
import { crossCorrelate } from './fft'
import { ENVELOPE_HZ } from './types'

/**
 * 從音訊測速度(BPM)與拍點位置。
 *
 * 完全重用音訊自動對齊已經算好的那份「起音強度包絡」——
 * 那本來就是「鼓點落在哪」的序列,測速度需要的資訊已經在裡面了,
 * 連 FFT 都不用再寫一份:自相關就是訊號和自己做互相關。
 *
 * 流程:
 *   onset 包絡 → 自相關 → 諧波加總 → 速度先驗加權 → 拋物線內插 → BPM
 *                                                    → 脈衝串掃描 → 相位
 *
 * 為什麼相位不能省:
 *   只知道 110 BPM 沒有用,還要知道拍點「落在哪」。
 *   預備拍的最後一聲必須剛好落在歌曲第一個重拍的前一拍,接進去才是連續的;
 *   不管相位的話,節拍器會跟歌整個錯開,這個功能就廢了。
 */

export const MIN_BPM = 60
export const MAX_BPM = 200

/**
 * 低於這個信心度就當作「測不出穩定的拍子」。
 *
 * 合成訊號實測(見 tempo.test.ts):
 *   偵測正確      0.17 ~ 0.84(含重雜訊、±80ms 抖動、每四拍才一個重拍)
 *   偵測失敗/雜訊 0.02 ~ 0.08
 * 中間有一段空隙,門檻取 0.12。
 */
export const MIN_CONFIDENCE = 0.12

/**
 * 速度先驗的中心與寬度(以八度為單位)。
 *
 * 自相關在 55、110、220 BPM 都會有同樣高的峰值 —— 這是這類演算法的經典毛病。
 * 硬性折疊到某個區間會把真正的慢歌誤判成兩倍速,所以改用加權:
 * 靠近 120 的候選有優勢,但夠強的慢速峰值仍然贏得了。
 */
const PRIOR_CENTER_BPM = 120
const PRIOR_WIDTH_OCTAVES = 0.7

/** 諧波加總的權重。週期為 P 的訊號在 2P、3P、4P 也會有峰值,一起看比較不容易被雜訊騙。 */
const HARMONIC_WEIGHTS = [1, 0.5, 0.25, 0.125]

/** 至少要這麼長才測得準 —— 諧波加總會看到 4 倍週期,最慢的情況是 4 秒 */
const MIN_SECONDS = 8

/**
 * 自相關的延遲搜尋步進(格)。
 *
 * 100Hz 的包絡在 160 BPM 時一拍是 37.5 格 —— 真正的週期落在格點之間。
 * 只看整數延遲的話,基頻的峰值被抹平,而 2 倍週期(75 格,剛好整數)反而更銳利,
 * 結果 160 BPM 會被判成 80。所以要用分數延遲。
 */
const LAG_STEP = 0.25

/**
 * 平滑化的半寬(格)。
 *
 * 分數延遲要有意義,峰值就不能只有一格寬 —— 否則內插只是在兩個低點之間取平均,
 * 補不回被量化吃掉的高度。把每個起音抹開約 ±20ms,這對真實鼓點也更合理。
 */
const SMOOTH_HALF_WIDTH = 2

/** 估相位時只看開頭這段。速度有一點點誤差時,越往後掃描位置漂移越大,
 *  而預備拍只在乎開頭的拍點落在哪。 */
const PHASE_WINDOW_SECONDS = 20

export interface TempoEstimate {
  bpm: number
  /** 一拍幾毫秒 */
  beatPeriodMs: number
  /** 第一個拍點落在音訊的第幾毫秒,0 <= phaseMs < beatPeriodMs */
  phaseMs: number
  /**
   * 這段音訊到底有多「週期性」:偵測到的週期上的正規化自相關值 (0..1)。
   * 訊號本身標準化過,所以零延遲的自相關是 1,這個值可以直接當比例讀。
   */
  strength: number
  /** 主峰領先「速度明顯不同的次高峰」的幅度 (0..1) */
  margin: number
  /**
   * 綜合信心度 = min(strength, margin)。
   *
   * 兩個都要看。只看 margin 會被白雜訊騙:雜訊的所有分數都趨近 0,
   * 隨機的最大值除以次大值照樣得到 0.8 的漂亮比例 —— 比值型指標在分母很小時會爆掉,
   * 這跟音訊對齊那邊踩過的是同一個坑。strength 是絕對量,補得起來。
   */
  confidence: number
}

const bpmToLag = (bpm: number) => (60 / bpm) * ENVELOPE_HZ
const lagToBpm = (lag: number) => (60 * ENVELOPE_HZ) / lag

function tempoPrior(bpm: number): number {
  const x = Math.log2(bpm / PRIOR_CENTER_BPM) / PRIOR_WIDTH_OCTAVES
  return Math.exp(-0.5 * x * x)
}

export function detectTempo(onset: Float32Array): TempoEstimate {
  const n = onset.length
  if (n < ENVELOPE_HZ * MIN_SECONDS) {
    throw new Error(`音訊太短,至少要 ${MIN_SECONDS} 秒才測得出速度`)
  }

  const smoothed = smooth(onset, SMOOTH_HALF_WIDTH)
  const sig = standardize(smoothed)
  const corr = crossCorrelate(sig, sig)

  /**
   * 自相關在延遲 k 的值,k 可以是分數。
   * 除以重疊點數是無偏估計,否則長延遲會被系統性低估。
   */
  const autocorr = (k: number) => {
    if (k <= 1 || k >= n - 2) return 0
    const i = Math.floor(k)
    const f = k - i
    const a = corr[i] / (n - i)
    const b = corr[i + 1] / (n - i - 1)
    return a * (1 - f) + b * f
  }

  const minLag = Math.max(2, bpmToLag(MAX_BPM))
  const maxLag = Math.min(bpmToLag(MIN_BPM), Math.floor(n / 5))
  if (maxLag <= minLag) throw new Error('音訊太短,測不出速度')

  const lagAt = (i: number) => minLag + i * LAG_STEP
  const scores: number[] = []
  for (let lag = minLag; lag <= maxLag; lag += LAG_STEP) {
    let harmonic = 0
    for (let h = 0; h < HARMONIC_WEIGHTS.length; h++) {
      harmonic += HARMONIC_WEIGHTS[h] * autocorr(lag * (h + 1))
    }
    scores.push(harmonic * tempoPrior(lagToBpm(lag)))
  }

  let bestIdx = 0
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bestIdx]) bestIdx = i

  const refinedLag = lagAt(bestIdx) + parabolicOffset(scores, bestIdx) * LAG_STEP
  const beatPeriodMs = (refinedLag / ENVELOPE_HZ) * 1000
  const phaseSamples = estimatePhase(smoothed, refinedLag)

  const strength = Math.max(0, Math.min(1, autocorr(refinedLag)))
  const margin = peakMargin(scores, bestIdx, lagAt)

  return {
    bpm: lagToBpm(refinedLag),
    beatPeriodMs,
    phaseMs: (phaseSamples / ENVELOPE_HZ) * 1000,
    strength,
    margin,
    confidence: Math.min(strength, margin),
  }
}

/** 三角核平滑。讓每個起音佔好幾格,分數延遲的內插才有東西可以內插。 */
function smooth(src: Float32Array, halfWidth: number): Float32Array {
  const weights: number[] = []
  let total = 0
  for (let d = -halfWidth; d <= halfWidth; d++) {
    const w = 1 - Math.abs(d) / (halfWidth + 1)
    weights.push(w)
    total += w
  }
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) {
    let sum = 0
    for (let d = -halfWidth; d <= halfWidth; d++) {
      const j = i + d
      if (j >= 0 && j < src.length) sum += src[j] * weights[d + halfWidth]
    }
    out[i] = sum / total
  }
  return out
}

/** 用相鄰三點配一條拋物線,取頂點位置當作次格點的峰值偏移 */
function parabolicOffset(scores: number[], i: number): number {
  if (i <= 0 || i >= scores.length - 1) return 0
  const denom = scores[i - 1] - 2 * scores[i] + scores[i + 1]
  if (denom === 0) return 0
  const delta = (0.5 * (scores[i - 1] - scores[i + 1])) / denom
  return Math.max(-0.5, Math.min(0.5, delta))
}

/**
 * 主峰領先「明顯不同速度的次高峰」多少。
 *
 * 刻意排除主峰附近的肩膀(±10% 速度以內),以及 2 倍、1/2 倍的八度關係 ——
 * 那些不算是「另一個答案」,只是同一個拍子的另一種數法。
 */
function peakMargin(
  scores: number[],
  bestIdx: number,
  lagAt: (i: number) => number,
): number {
  const bestBpm = lagToBpm(lagAt(bestIdx))
  let runnerUp = 0
  for (let i = 0; i < scores.length; i++) {
    const bpm = lagToBpm(lagAt(i))
    const ratio = bpm / bestBpm
    const nearSelf = Math.abs(Math.log2(ratio)) < 0.14
    const nearOctave = [0.5, 2].some((o) => Math.abs(Math.log2(ratio / o)) < 0.14)
    if (nearSelf || nearOctave) continue
    if (scores[i] > runnerUp) runnerUp = scores[i]
  }
  const best = scores[bestIdx]
  if (best <= 0) return 0
  return Math.max(0, Math.min(1, (best - runnerUp) / best))
}

/**
 * 拍點落在哪:拿一串間隔為 period 的脈衝掃過整條包絡,
 * 取「打在起音上」總和最高的那個位移。
 */
function estimatePhase(onset: Float32Array, periodSamples: number): number {
  // 只掃開頭這段:速度有一點點誤差時,越往後掃描位置漂移越大,
  // 而預備拍只在乎「開頭的拍點落在哪」
  const limit = Math.min(onset.length, PHASE_WINDOW_SECONDS * ENVELOPE_HZ)
  const steps = 96
  let bestPhase = 0
  let bestScore = -Infinity
  for (let s = 0; s < steps; s++) {
    const phase = (s / steps) * periodSamples
    let sum = 0
    let count = 0
    for (let t = phase; t < limit; t += periodSamples) {
      sum += onset[Math.round(t)] ?? 0
      count++
    }
    // 不同位移打到的拍數可能差一拍,除以次數才公平
    const score = count > 0 ? sum / count : 0
    if (score > bestScore) {
      bestScore = score
      bestPhase = phase
    }
  }
  return bestPhase
}
