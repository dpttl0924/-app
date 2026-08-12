import { crossCorrelate } from './fft'
import { ENVELOPE_HZ } from './types'

/**
 * 音訊自動對齊。
 *
 * 前提:兩段影片跳的是同一首歌,所以音訊內容幾乎相同、只差一個時間偏移。
 * 那就不必讓使用者手動拉時間軸 —— 直接算出偏移量。
 *
 * 流程:
 *   解碼 → 混單聲道 → 100Hz 音量包絡 → 對數壓縮 → 正向差分(起音強度)
 *   → 正規化 → FFT 互相關 → 重疊區 Pearson 相關係數 → 找峰值
 *
 * 為什麼比對「起音強度」而不是「音量包絡」:
 *   音量包絡會被兩支影片的錄音音量、EQ、環境噪音整體平移,相關性容易被低頻成分主導。
 *   正向差分只留下「音量突然變大」的瞬間 —— 也就是鼓點和重拍 —— 對響度差異免疫,
 *   峰值也尖銳得多。解析度上限由 ENVELOPE_HZ 決定,100Hz 即 10ms。
 */

export interface AudioAnalysis {
  /** 音量包絡(ENVELOPE_HZ),畫波形用 */
  envelope: Float32Array
  /** 起音強度包絡(ENVELOPE_HZ),對齊用 */
  onset: Float32Array
}

export interface AlignResult {
  /** offsetB - offsetA,單位 ms。正值代表 B 要往後推。 */
  lagMs: number
  /** 重疊區上的 Pearson 相關係數(-1..1)。同一首歌通常 > 0.6。 */
  score: number
  /** 距離主峰 1 秒以上的次高峰分數 */
  runnerUpScore: number
  /** 次高峰的位置,也就是「另一個候選答案」 */
  runnerUpLagMs: number
  /** 主峰領先次高峰的幅度 (0..1) */
  margin: number
  /**
   * 是否存在另一個分數接近的候選位置。
   *
   * 這是「還有別的可能」的提示,不是「對錯」的判決 —— 這點是實測之後才改的。
   *
   * 原本想在這裡給一個可信度分數,試過的都失敗:
   *   1. 峰值對全體分數的 z-score:不管兩段音訊有沒有關係都落在 7.0~7.4,毫無鑑別力。
   *   2. 相關係數本身:兩首無關但同 BPM 的歌照樣拿 0.93,因為拍點位置本來就對得上。
   *
   * margin 也不能單獨當判準,因為它嚴重取決於素材:
   *   振幅變化豐富的訊號    對齊成功 0.061~0.076 / 失敗 0.000~0.030
   *   純打擊樂(嗶聲+靜音)  對齊成功 0.006      / 失敗 0.000
   * 後者正確答案的 margin 幾乎和退化情況重疊,任何門檻都會誤報。
   *
   * 結論:只要兩段真的是同一首歌,偏移量本身一律算得準(合成與真實音訊都驗過),
   * 但沒有便宜的純量能判斷成敗。所以這裡只把次高峰當成「另一個候選」交出去,
   * 由 UI 讓使用者一鍵切換,最終以時間軸上兩條波形是否對齊為準。
   */
  hasAlternative: boolean
}

/** 次高峰分數在主峰的這個比例之內,就當成值得一提的另一個候選 */
const ALTERNATIVE_THRESHOLD = 0.05

/**
 * 分析用的解碼取樣率。
 *
 * decodeAudioData 會把音訊重新取樣到 context 的取樣率,所以這個值直接決定
 * 解碼後佔多少記憶體 —— 3 分鐘的影片在 48kHz 立體聲是約 69MB,兩支就 138MB,
 * 在 iPhone 上很容易讓 Safari 直接把分頁回收掉(選完影片回不了網頁就是這個症狀)。
 *
 * 16kHz 單聲道是 6 分之一(約 11.5MB)。選 16k 而不是更低,是因為包絡是靠
 * 每 10ms 的 RMS 能量算的,取樣率太低會把小鼓與 hi-hat 的高頻瞬態濾掉,
 * 起音會變鈍。16kHz 保留到 8kHz,鼓組的資訊幾乎都還在。
 *
 * 包絡本身只有 100Hz,所以這個取樣率遠遠夠用。
 */
const ANALYSIS_SAMPLE_RATE = 16000

let sharedCtx: OfflineAudioContext | null = null
function getDecodeContext(): OfflineAudioContext {
  if (!sharedCtx) sharedCtx = new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE)
  return sharedCtx
}

/** 從影片/音訊檔抽出包絡。丟不出音軌會 throw。 */
export async function analyzeAudio(file: Blob): Promise<AudioAnalysis> {
  const bytes = await file.arrayBuffer()
  const audio = await getDecodeContext().decodeAudioData(bytes)

  const sr = audio.sampleRate
  const frames = audio.length
  const channels = audio.numberOfChannels
  const hop = Math.max(1, Math.round(sr / ENVELOPE_HZ))
  const buckets = Math.floor(frames / hop)
  if (buckets < 2) throw new Error('音訊太短,無法分析')

  const data: Float32Array[] = []
  for (let c = 0; c < channels; c++) data.push(audio.getChannelData(c))

  // 每個 hop 取 RMS,順便混成單聲道
  const envelope = new Float32Array(buckets)
  for (let i = 0; i < buckets; i++) {
    const start = i * hop
    let sum = 0
    for (let j = 0; j < hop; j++) {
      let s = 0
      for (let c = 0; c < channels; c++) s += data[c][start + j]
      s /= channels
      sum += s * s
    }
    envelope[i] = Math.sqrt(sum / hop)
  }

  // 對數壓縮後取正向差分 = 起音強度
  const onset = new Float32Array(buckets)
  let prev = Math.log1p(envelope[0] * 50)
  for (let i = 1; i < buckets; i++) {
    const cur = Math.log1p(envelope[i] * 50)
    onset[i] = Math.max(0, cur - prev)
    prev = cur
  }

  return { envelope, onset }
}

/** 減平均、除標準差。互相關前一定要做,否則直流成分會蓋掉真正的峰值。 */
export function standardize(src: Float32Array): Float32Array {
  const n = src.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += src[i]
  mean /= n
  let variance = 0
  for (let i = 0; i < n; i++) {
    const d = src[i] - mean
    variance += d * d
  }
  const sd = Math.sqrt(variance / n) || 1
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = (src[i] - mean) / sd
  return out
}

function prefixSums(src: Float32Array) {
  const n = src.length
  const sum = new Float64Array(n + 1)
  const sumSq = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    sum[i + 1] = sum[i] + src[i]
    sumSq[i + 1] = sumSq[i] + src[i] * src[i]
  }
  return { sum, sumSq }
}

/** 兩個峰值要相隔多遠才算是「不同的答案」。1 秒內的相鄰高點只是同一個峰的肩膀。 */
const PEAK_SEPARATION = ENVELOPE_HZ

/**
 * 算出 B 相對於 A 的時間偏移。
 * @param maxLagMs 只在這個範圍內找,預設 ±60 秒。範圍越小越不容易被雜訊騙。
 */
export function alignOnsets(
  onsetA: Float32Array,
  onsetB: Float32Array,
  maxLagMs = 60_000,
): AlignResult {
  const a = standardize(onsetA)
  const b = standardize(onsetB)
  const corr = crossCorrelate(a, b)
  const n = corr.length
  const la = a.length
  const lb = b.length

  const pa = prefixSums(a)
  const pb = prefixSums(b)

  const maxLag = Math.min(Math.round((maxLagMs / 1000) * ENVELOPE_HZ), Math.max(la, lb))
  // 重疊太少的 lag 不可信:至少要 5 秒、且不少於較短那段的四分之一
  const minOverlap = Math.max(ENVELOPE_HZ * 5, Math.floor(Math.min(la, lb) * 0.25))

  const lags: number[] = []
  const scores: number[] = []

  for (let k = -maxLag; k <= maxLag; k++) {
    // 這個 lag 下,b[lo..hi) 對上 a[lo+k..hi+k)
    const lo = Math.max(0, -k)
    const hi = Math.min(lb, la - k)
    const overlap = hi - lo
    if (overlap < minOverlap) continue

    const idx = k >= 0 ? k : n + k
    const sumAB = corr[idx] // 補零讓循環相關等於線性相關,所以這就是重疊區的 Σab

    // 在重疊區上算 Pearson 相關係數。
    // 早期版本是 corr/overlap,結果偏袒重疊少的 lag —— 視窗越小,平均乘積的變異數越大,
    // 極端值就越容易冒出來當冠軍。Pearson 把值限制在 [-1,1],小視窗就不再有這種紅利。
    const sumB = pb.sum[hi] - pb.sum[lo]
    const sumB2 = pb.sumSq[hi] - pb.sumSq[lo]
    const sumA = pa.sum[hi + k] - pa.sum[lo + k]
    const sumA2 = pa.sumSq[hi + k] - pa.sumSq[lo + k]

    const varA = overlap * sumA2 - sumA * sumA
    const varB = overlap * sumB2 - sumB * sumB
    const den = Math.sqrt(Math.max(0, varA) * Math.max(0, varB))
    const r = den > 0 ? (overlap * sumAB - sumA * sumB) / den : 0

    lags.push(k)
    scores.push(r)
  }

  if (lags.length === 0) throw new Error('兩段影片重疊太少,無法對齊')

  let bestIdx = 0
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bestIdx]) bestIdx = i
  const bestLag = lags[bestIdx]
  const bestScore = scores[bestIdx]

  let runnerUp = -Infinity
  let runnerUpLag = 0
  for (let i = 0; i < scores.length; i++) {
    if (Math.abs(lags[i] - bestLag) > PEAK_SEPARATION && scores[i] > runnerUp) {
      runnerUp = scores[i]
      runnerUpLag = lags[i]
    }
  }
  if (runnerUp === -Infinity) {
    // 搜尋範圍太窄,只有一個峰,無從比較
    runnerUp = 0
    runnerUpLag = 0
  }

  const margin = bestScore > 0 ? (bestScore - runnerUp) / bestScore : 0

  return {
    lagMs: (bestLag * 1000) / ENVELOPE_HZ,
    score: bestScore,
    runnerUpScore: runnerUp,
    runnerUpLagMs: (runnerUpLag * 1000) / ENVELOPE_HZ,
    margin,
    hasAlternative: margin < ALTERNATIVE_THRESHOLD,
  }
}
