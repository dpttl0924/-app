/**
 * 從屬影片的漂移校正。
 *
 * 兩支影片各自有獨立的解碼時鐘,一定會慢慢分開。把落後的那支「拉回去」有兩種手段:
 *
 *   seek  —— 立刻歸位,但播放中 seek 會讓解碼器停頓,是肉眼可見的一頓
 *   微調速度 —— 用 ±幾 % 的播放速度慢慢追,收斂過程完全看不出來
 *
 * 早期版本只有 seek,而且門檻設在 60ms,結果變成卡頓的來源:
 * video.currentTime 只在影格邊界更新,30fps 的影片本來就會以 ~33ms 為階梯跳動,
 * 所以完美同步時量到的誤差也會震盪 ±33ms,很容易越過門檻 ——
 * 一 seek 就停頓、停頓讓誤差變大、於是再 seek。
 *
 * 現在以微調速度為主,只有大到追不回來時才 seek。
 */

/**
 * 誤差超過這個秒數才值得付 seek 的停頓代價。
 *
 * 下限由影格量化決定:24fps 的 currentTime 以 ~42ms 為階梯跳動,
 * 門檻必須遠高於這個值才不會被雜訊觸發。0.25 秒有六倍餘裕。
 */
export const HARD_SEEK_S = 0.25

/**
 * 靜音影片的速度修正上限。
 * 看不出來(±10% 的動作速度差要並排逐幀比才分辨得出),而且沒有聲音可以被聽出來。
 * 預設情況下 B 就是靜音的,所以這是常見路徑。
 */
export const MUTED_MAX_TRIM = 0.1

/**
 * 有聲音的影片的速度修正上限。
 * 超過 3% 開始聽得出音高/節奏被動過,所以寧可收斂慢一點。
 */
export const AUDIBLE_MAX_TRIM = 0.03

/**
 * 死區:誤差在一格以內就完全不修正。
 *
 * 這是整個機制的關鍵。currentTime 以影格為階梯跳動,所以「完美同步」量起來
 * 本來就有 ±一格的誤差 —— 對這種雜訊做修正,只會讓 playbackRate 一直抖。
 * 而且一格以內的不同步,逐幀比對時本來就分辨不出來,修了也沒有意義。
 *
 * 有了死區才敢把增益調高,收斂才快得起來。
 */
export const DEADBAND_S = 0.04

/**
 * 超出死區的部分換算成速度修正的增益。
 *
 * 沒有死區時只能用 0.5,否則會放大量化雜訊;
 * 但 0.5 的時間常數是 2 秒,0.24 秒的誤差要 7.8 秒才追得完,不同步早就被看到了。
 */
export const TRIM_GAIN = 2

/**
 * 速度修正的量化階距。
 *
 * 這是手機上「從屬影片會卡頓」的解方。修正量本來是連續值,誤差每幀都在變,
 * 於是 playbackRate 幾乎每幀都被改寫一次 —— 桌機吃得下,但手機每改一次
 * 都要重新對時音視訊管線,結果就是被校正的那一支(通常是 B)一直抖。
 *
 * 量化成 1% 的階梯之後,只有跨過階距時才會真的寫入,寫入次數少了好幾個數量級。
 * 對收斂速度幾乎沒有影響 —— 修正量本來就是控制訊號,差 1% 不影響追上的時間。
 */
export const RATE_STEP = 0.01

/**
 * 在這段時間內硬 seek 超過 STRAIN_SEEK_LIMIT 次,就判定這台裝置追不上。
 *
 * 正常情況下硬 seek 應該非常罕見(只在拖完時間軸之類的時候發生一次)。
 * 短時間內反覆 seek 代表從屬影片根本解碼不贏 —— 手機同時解兩支高解析度影片
 * 就會這樣。這時候繼續 seek 只會讓畫面一直停頓,不如放手讓它漂移。
 */
export const STRAIN_WINDOW_MS = 5000
export const STRAIN_SEEK_LIMIT = 3

export interface DriftCorrection {
  /** 是否要硬 seek 回去 */
  seek: boolean
  /** 這一幀該套用的 playbackRate */
  rate: number
}

/**
 * 追蹤硬 seek 的頻率,判斷裝置是不是根本追不上。
 *
 * 一旦判定追不上就停止硬 seek:反覆 seek 造成的停頓,比讓兩支影片稍微不同步
 * 還要難用得多。同時把狀態透出去,好讓 UI 告訴使用者為什麼會這樣 ——
 * 沒有說明的話,使用者只會覺得「這個網站很爛」。
 */
export class SeekStrainMonitor {
  private timestamps: number[] = []

  /** 記錄一次硬 seek。回傳現在是否已經判定為追不上。 */
  record(nowMs: number): boolean {
    this.timestamps.push(nowMs)
    this.prune(nowMs)
    return this.strained(nowMs)
  }

  strained(nowMs: number): boolean {
    this.prune(nowMs)
    return this.timestamps.length >= STRAIN_SEEK_LIMIT
  }

  reset() {
    this.timestamps.length = 0
  }

  private prune(nowMs: number) {
    const cutoff = nowMs - STRAIN_WINDOW_MS
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift()
    }
  }
}

/**
 * @param errorSec 應該播到的時間 減去 實際播到的時間。正值代表落後,要加速。
 * @param baseRate 使用者選的播放速度(0.25 / 0.5 / 1)
 * @param maxTrim  速度修正上限,依這支影片有沒有聲音而定
 */
export function correctDrift(
  errorSec: number,
  baseRate: number,
  maxTrim: number = MUTED_MAX_TRIM,
): DriftCorrection {
  const magnitude = Math.abs(errorSec)
  if (magnitude > HARD_SEEK_S) {
    return { seek: true, rate: baseRate }
  }
  if (magnitude <= DEADBAND_S) {
    return { seek: false, rate: baseRate }
  }
  // 只對超出死區的部分做修正,修正量才會在死區邊界連續、不會突然跳一階
  const excess = Math.sign(errorSec) * (magnitude - DEADBAND_S)
  const raw = clamp(excess * TRIM_GAIN, -maxTrim, maxTrim)
  // 量化成階梯,playbackRate 才不會每幀都被改寫(見 RATE_STEP)
  const trim = Math.round(raw / RATE_STEP) * RATE_STEP
  return { seek: false, rate: baseRate * (1 + trim) }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}
