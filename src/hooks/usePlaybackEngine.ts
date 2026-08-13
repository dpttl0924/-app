import { useEffect } from 'react'
import type { RefObject } from 'react'
import { playRange, timelineMap, useProject } from '../store/useProject'
import { contentToProject, isInCountIn, projectToContent } from '../lib/timeline'
import { resolveClipTime } from '../lib/layout'
import { playbackClock } from '../lib/playbackClock'
import {
  AUDIBLE_MAX_TRIM,
  MUTED_MAX_TRIM,
  SeekStrainMonitor,
  correctDrift,
} from '../lib/sync'
import type { Clip, ClipId } from '../lib/types'

export type VideoRefs = Record<ClipId, RefObject<HTMLVideoElement | null>>

/** 同步回 store 的頻率。播放頭與時間顯示走 DOM 直寫,不受這個限制。 */
const STORE_SYNC_INTERVAL_MS = 100

/**
 * 播放同步引擎。
 *
 * 專案時間以「其中一支正在播的影片」為準,而不是牆鐘。
 *
 * 早期版本是牆鐘推進、誤差超過 60ms 就 seek 校正,結果反而是卡頓的來源:
 * video.currentTime 只在影格邊界更新,30fps 的影片會以 ~33ms 為階梯跳動,
 * 所以即使完全同步,量到的誤差也會自然震盪 ±33ms。加上 rAF 抖動就會越過門檻,
 * 一 seek 就停頓、停頓後誤差更大、於是再 seek —— 自我強化的迴圈。
 *
 * 現在的做法:
 *   主控影片   直接拿它的 currentTime 當專案時間,它自己播自己的,永遠不用校正
 *   另一支     算出誤差後微調 playbackRate 慢慢追回來,不 seek
 *   都不在範圍 才退回牆鐘推進(例如 A 播完了、B 還沒開始的空檔)
 *
 * 這是串流播放器對付時鐘漂移的標準做法,收斂過程完全看不出來。
 */
export function usePlaybackEngine(refs: VideoRefs) {
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let lastStoreSync = 0
    const strain = new SeekStrainMonitor()

    const tick = () => {
      const now = performance.now()
      const delta = now - last
      last = now

      const state = useProject.getState()
      const { playing, durationMs, rate, clips } = state
      const map = timelineMap(state)
      // 預備拍那段沒有影片內容,不能拿影片當時鐘主控 —— 它會把播放頭
      // 直接拉出預備拍區間,節拍器等於沒響
      const inCountIn = isInCountIn(playbackClock.currentMs, map)
      const contentMs = projectToContent(playbackClock.currentMs, map)
      const master = playing && !inCountIn ? pickMaster(refs, clips, contentMs) : null

      if (playing && durationMs > 0) {
        if (master) {
          // 跟著主控影片自己的解碼時鐘走,它想播多快就多快
          const el = refs[master].current!
          playbackClock.currentMs = contentToProject(
            el.currentTime * 1000 + clips[master]!.offsetMs,
            map,
          )
        } else {
          playbackClock.currentMs += delta * rate
        }

        // 播到輸出範圍的終點就停,這樣預覽看到的就是匯出會得到的東西
        const endMs = playRange(state).endMs
        if (playbackClock.currentMs >= endMs) {
          playbackClock.currentMs = endMs
          useProject.getState().setPlaying(false)
          useProject.getState().seek(endMs)
          lastStoreSync = now
        }
      }

      const contentNow = projectToContent(playbackClock.currentMs, map)
      // 預備拍期間影片要停住,只有節拍器在響
      const clipsRunning = playing && !isInCountIn(playbackClock.currentMs, map)

      for (const id of ['a', 'b'] as ClipId[]) {
        const el = refs[id].current
        const clip = clips[id]
        if (!el || !clip) continue

        const { targetSec, inRange } = resolveClipTime(clip, contentNow)
        setVolume(el, clip.volume)

        if (!clipsRunning || !inRange) {
          if (!el.paused) el.pause()
          setRate(el, rate)
          // 暫停時要跟上播放頭,否則拖時間軸畫面不會動
          if (Math.abs(el.currentTime - targetSec) > 0.004) el.currentTime = targetSec
          continue
        }

        if (el.paused) void el.play().catch(() => {})

        if (id === master) {
          setRate(el, rate)
          continue
        }

        // 靜音的那支可以用大一點的修正幅度,反正沒有聲音會被聽出來
        const maxTrim = clip.volume > 0.01 ? AUDIBLE_MAX_TRIM : MUTED_MAX_TRIM
        const correction = correctDrift(targetSec - el.currentTime, rate, maxTrim)
        // 已經判定裝置追不上時就不再硬 seek —— 反覆 seek 的停頓比稍微不同步難用得多
        if (correction.seek && !strain.strained(now)) {
          el.currentTime = targetSec
          if (strain.record(now)) useProject.getState().setSyncStrained(true)
        }
        setRate(el, correction.rate)
      }

      // React 端節流。標註的出現/消失差 100ms 看不出來,
      // 但每幀 set 一次 store 會讓整棵樹一秒重繪 60 次。
      const store = useProject.getState()
      const drifted = Math.abs(store.currentMs - playbackClock.currentMs) > 1
      if (drifted && (!playing || now - lastStoreSync >= STORE_SYNC_INTERVAL_MS)) {
        lastStoreSync = now
        store.seek(playbackClock.currentMs)
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [refs])
}

/**
 * 選一支影片當時鐘主控:優先 A,A 不在範圍內就用 B。
 * 兩支都不在範圍內回傳 null(例如 A 播完、B 還沒開始的空檔)。
 */
function pickMaster(
  refs: VideoRefs,
  clips: Record<ClipId, Clip | null>,
  projectMs: number,
): ClipId | null {
  for (const id of ['a', 'b'] as ClipId[]) {
    const el = refs[id].current
    const clip = clips[id]
    if (!el || !clip || el.readyState < 2) continue
    if (resolveClipTime(clip, projectMs).inRange) return id
  }
  return null
}

/** 只在真的變了才寫。每幀重設 playbackRate 會打擾媒體管線。 */
function setRate(el: HTMLVideoElement, value: number) {
  if (Math.abs(el.playbackRate - value) > 0.002) el.playbackRate = value
}

function setVolume(el: HTMLVideoElement, value: number) {
  if (Math.abs(el.volume - value) > 0.01) el.volume = value
}
