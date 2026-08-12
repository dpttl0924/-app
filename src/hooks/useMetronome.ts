import { useEffect, useRef } from 'react'
import { audioContext, resumeAudio } from '../lib/audioBus'
import { scheduleClicks, type ScheduledMetronome } from '../lib/metronome'
import { playbackClock } from '../lib/playbackClock'
import { relativeToCountIn } from '../lib/timeline'
import { countInPlan, timelineMap, useProject } from '../store/useProject'

/**
 * 預覽時的預備拍節拍器。
 *
 * 一開始播就把剩下的 click 全部排進 Web Audio,而不是每幀去檢查「該響了沒」——
 * rAF 的時間點會抖 ±16ms,預備拍抖成那樣就失去意義了。
 *
 * 暫停、拖時間軸、改設定都要取消重排,否則會聽到不該響的 click。
 */
export function useMetronome() {
  const scheduled = useRef<ScheduledMetronome | null>(null)
  const playing = useProject((s) => s.playing)
  const rate = useProject((s) => s.rate)
  const countIn = useProject((s) => s.countIn)
  const tempo = useProject((s) => s.tempo)
  const rangeInMs = useProject((s) => s.rangeInMs)

  useEffect(() => {
    scheduled.current?.cancel()
    scheduled.current = null
    if (!playing || !countIn.enabled) return

    const plan = countInPlan(countIn, tempo?.phaseMs ?? 0)
    if (plan.clickTimesMs.length === 0) return

    // clickTimesMs 是相對於預備拍插入點(剪輯起點)算的,不是相對於專案時間 0。
    // 剪過片之後插入點會 > 0,播放頭的絕對時間要先扣掉這個位移才能跟
    // clickTimesMs 放進同一個座標系比較 —— 少了這一步,剪過片之後
    // 播放頭永遠「看起來」已經超過預備拍,於是直接跳過排程,完全沒聲音。
    const at = relativeToCountIn(
      playbackClock.currentMs,
      timelineMap({ countIn, tempo, rangeInMs }),
    )
    // 播放頭已經越過預備拍了就不用響
    if (at >= plan.durationMs) return

    let cancelled = false
    void resumeAudio().then(() => {
      if (cancelled) return
      scheduled.current = scheduleClicks(audioContext(), plan.clickTimesMs, {
        startOffsetMs: at,
        volume: countIn.volume,
        rate,
        destinations: [audioContext().destination],
      })
    })

    return () => {
      cancelled = true
      scheduled.current?.cancel()
      scheduled.current = null
    }
    // playing 由 false→true 時重排;拖時間軸會先暫停,所以也會走到這裡
  }, [playing, rate, countIn, tempo, rangeInMs])

  useEffect(() => () => scheduled.current?.cancel(), [])
}
