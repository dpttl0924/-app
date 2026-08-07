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

export interface DriftCorrection {
  /** 是否要硬 seek 回去 */
  seek: boolean
  /** 這一幀該套用的 playbackRate */
  rate: number
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
  const trim = clamp(excess * TRIM_GAIN, -maxTrim, maxTrim)
  return { seek: false, rate: baseRate * (1 + trim) }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}
