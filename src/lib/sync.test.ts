import { describe, expect, it } from 'vitest'
import {
  AUDIBLE_MAX_TRIM,
  DEADBAND_S,
  HARD_SEEK_S,
  MUTED_MAX_TRIM,
  RATE_STEP,
  STRAIN_SEEK_LIMIT,
  STRAIN_WINDOW_MS,
  SeekStrainMonitor,
  correctDrift,
} from './sync'

/**
 * 收斂目標:50ms,約 1.5 格。
 *
 * 不能拿死區邊界當目標 —— 比例修正在邊界會趨近於零,誤差是逼近而非跨越,
 * 用死區當終止條件會跑到天荒地老。這個值是「實務上已經看不出來」的門檻。
 */
const CONVERGED_S = DEADBAND_S + 0.01

/** 反覆套用修正,回傳誤差收斂到 CONVERGED_S 以內需要幾秒 */
function secondsToConverge(startError: number, maxTrim: number): number {
  const frame = 1 / 60
  let error = startError
  let frames = 0
  while (Math.abs(error) > CONVERGED_S && frames < 60 * 120) {
    const { rate, seek } = correctDrift(error, 1, maxTrim)
    if (seek) return 0 // 一次 seek 就歸位
    error -= (rate - 1) * frame
    frames++
  }
  return frames / 60
}

describe('correctDrift', () => {
  it('完全同步時不動作,速度就是使用者選的速度', () => {
    expect(correctDrift(0, 1)).toEqual({ seek: false, rate: 1 })
  })

  it('落後時加速追上,超前時減速等待', () => {
    expect(correctDrift(0.05, 1).rate).toBeGreaterThan(1)
    expect(correctDrift(-0.05, 1).rate).toBeLessThan(1)
  })

  it('影格量化造成的震盪完全不觸發修正', () => {
    // 這正是舊版卡頓的來源:30fps 的 currentTime 以 ~33ms 為階梯跳動,
    // 完美同步時量到的誤差也會在這個範圍內來回,舊版 60ms 門檻很容易被越過。
    // 現在死區直接把這段雜訊吃掉,速度連動都不動。
    for (const errorSec of [0, 0.02, -0.02, 0.033, -0.033, DEADBAND_S, -DEADBAND_S]) {
      expect(correctDrift(errorSec, 1)).toEqual({ seek: false, rate: 1 })
    }
  })

  it('死區至少要蓋得住最低 fps 的一格', () => {
    expect(DEADBAND_S).toBeGreaterThanOrEqual(1 / 30)
  })

  it('seek 門檻對影格量化雜訊要有足夠餘裕', () => {
    expect(HARD_SEEK_S).toBeGreaterThan((1 / 24) * 5)
  })

  it('修正量在死區邊界是連續的,不會突然跳一階', () => {
    const justInside = correctDrift(DEADBAND_S, 1).rate
    const justOutside = correctDrift(DEADBAND_S + 0.001, 1).rate
    expect(Math.abs(justOutside - justInside)).toBeLessThan(0.005)
  })

  it('速度修正不超過設定的上限', () => {
    for (const errorSec of [0.05, 0.15, 0.24, -0.05, -0.15, -0.24]) {
      expect(Math.abs(correctDrift(errorSec, 1, MUTED_MAX_TRIM).rate - 1)).toBeLessThanOrEqual(
        MUTED_MAX_TRIM + 1e-9,
      )
      expect(
        Math.abs(correctDrift(errorSec, 1, AUDIBLE_MAX_TRIM).rate - 1),
      ).toBeLessThanOrEqual(AUDIBLE_MAX_TRIM + 1e-9)
    }
  })

  it('誤差大到追不回來時才 seek', () => {
    expect(correctDrift(HARD_SEEK_S + 0.01, 1).seek).toBe(true)
    expect(correctDrift(-(HARD_SEEK_S + 0.01), 1).seek).toBe(true)
    expect(correctDrift(HARD_SEEK_S - 0.01, 1).seek).toBe(false)
  })

  it('慢速播放時,修正是基準速度的百分比而不是絕對值', () => {
    // 0.5x 播放時加速 10% 應該是 0.55,不是 1.1
    const { rate } = correctDrift(0.24, 0.5, MUTED_MAX_TRIM)
    expect(rate).toBeCloseTo(0.5 * (1 + MUTED_MAX_TRIM))
  })

  it('靜音影片:最差情況要在 3 秒內收斂,不然不同步會被看出來', () => {
    // 100~250ms 的不同步在舞蹈對比裡是明顯的,收斂太慢等於沒修
    expect(secondsToConverge(HARD_SEEK_S - 0.01, MUTED_MAX_TRIM)).toBeLessThan(3)
  })

  it('有聲音的影片收斂較慢,是為了不讓音高被聽出來而付的代價', () => {
    const muted = secondsToConverge(0.2, MUTED_MAX_TRIM)
    const audible = secondsToConverge(0.2, AUDIBLE_MAX_TRIM)
    expect(audible).toBeGreaterThan(muted)
    expect(audible).toBeLessThan(10)
  })

  it('修正量是量化的階梯,不是連續值', () => {
    // 手機上「從屬影片卡頓」的根因:連續值會讓 playbackRate 幾乎每幀都被改寫,
    // 每次改寫都要重新對時媒體管線。量化之後只有跨階時才會真的寫入。
    for (const errorSec of [0.05, 0.07, 0.09, 0.12, 0.15, 0.2]) {
      const trim = correctDrift(errorSec, 1, MUTED_MAX_TRIM).rate - 1
      const steps = trim / RATE_STEP
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-9)
    }
  })

  it('誤差連續變化時,實際會用到的速度值只有少數幾個', () => {
    const rates = new Set<number>()
    // 掃過死區到 seek 門檻之間的整段範圍
    for (let e = DEADBAND_S; e < HARD_SEEK_S; e += 0.0005) {
      rates.add(Number(correctDrift(e, 1, MUTED_MAX_TRIM).rate.toFixed(6)))
    }
    // 上限 10% ÷ 每階 1% = 最多 11 種(含不修正)
    expect(rates.size).toBeLessThanOrEqual(MUTED_MAX_TRIM / RATE_STEP + 1)
  })

  it('量化沒有破壞收斂 —— 最差情況仍在 3 秒內追上', () => {
    expect(secondsToConverge(HARD_SEEK_S - 0.01, MUTED_MAX_TRIM)).toBeLessThan(3)
  })

  it('收斂是單向的,不會衝過頭來回震盪', () => {
    let error = 0.2
    let previous = Math.abs(error)
    for (let i = 0; i < 600; i++) {
      const { rate } = correctDrift(error, 1, MUTED_MAX_TRIM)
      error -= (rate - 1) / 60
      const now = Math.abs(error)
      expect(now).toBeLessThanOrEqual(previous + 1e-9)
      previous = now
    }
  })
})

describe('SeekStrainMonitor', () => {
  it('偶爾一次硬 seek 不算追不上', () => {
    // 拖完時間軸之後 seek 一次是正常的,不該因此判定裝置有問題
    const m = new SeekStrainMonitor()
    expect(m.record(1000)).toBe(false)
    expect(m.strained(1000)).toBe(false)
  })

  it('短時間內反覆 seek 就判定追不上', () => {
    const m = new SeekStrainMonitor()
    let strained = false
    for (let i = 0; i < STRAIN_SEEK_LIMIT; i++) strained = m.record(1000 + i * 100)
    expect(strained).toBe(true)
  })

  it('久久才 seek 一次不會累積成誤判', () => {
    const m = new SeekStrainMonitor()
    // 每次都間隔超過觀察窗,舊紀錄要被丟掉
    for (let i = 0; i < 10; i++) {
      expect(m.record(i * (STRAIN_WINDOW_MS + 1000))).toBe(false)
    }
  })

  it('時間往前推進之後,舊的判定會自己解除', () => {
    const m = new SeekStrainMonitor()
    for (let i = 0; i < STRAIN_SEEK_LIMIT; i++) m.record(1000 + i * 100)
    expect(m.strained(1500)).toBe(true)
    expect(m.strained(1500 + STRAIN_WINDOW_MS + 1)).toBe(false)
  })

  it('reset 之後重新計算', () => {
    const m = new SeekStrainMonitor()
    for (let i = 0; i < STRAIN_SEEK_LIMIT; i++) m.record(1000 + i * 100)
    m.reset()
    expect(m.strained(1500)).toBe(false)
  })
})
