import { useEffect, useRef } from 'react'
import { useProject } from '../store/useProject'
import { formatTime } from '../lib/format'
import { playbackClock } from '../lib/playbackClock'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { Button } from './ui'

const RATES = [0.25, 0.5, 0.75, 1]

export function Transport() {
  const timeRef = useRef<HTMLSpanElement>(null)
  const wide = useMediaQuery('(min-width: 640px)')
  const playing = useProject((s) => s.playing)
  const rate = useProject((s) => s.rate)
  const durationMs = useProject((s) => s.durationMs)
  const togglePlay = useProject((s) => s.togglePlay)
  const stepFrame = useProject((s) => s.stepFrame)
  const seek = useProject((s) => s.seek)
  const setRate = useProject((s) => s.setRate)
  const setPlaying = useProject((s) => s.setPlaying)
  const toggleMirror = useProject((s) => s.toggleMirror)
  const syncStrained = useProject((s) => s.syncStrained)

  // 時間讀數每幀都變,走 DOM 直寫,不讓 React 每秒 render 60 次。
  // 讀 playbackClock 而非 store,後者是 10Hz 的節流鏡像。
  useEffect(() => {
    let raf = 0
    const loop = () => {
      const el = timeRef.current
      if (el) el.textContent = formatTime(playbackClock.currentMs)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        stepFrame(1)
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        stepFrame(-1)
      } else if (e.code === 'Home') {
        setPlaying(false)
        seek(0)
      } else if (e.code === 'KeyM') {
        // 鏡像常常要來回切著看哪邊才對得上,值得一個快捷鍵
        e.preventDefault()
        toggleMirror(e.shiftKey ? 'a' : 'b')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, stepFrame, seek, setPlaying, toggleMirror])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Button
          className="px-2"
          onClick={() => {
            setPlaying(false)
            seek(0)
          }}
          disabled={durationMs <= 0}
        >
          ⏮
        </Button>
        {/* 逐幀是舞蹈對比的核心操作,手機上要夠大按得到 */}
        <Button
          className="min-h-11 flex-1"
          onClick={() => stepFrame(-1)}
          disabled={durationMs <= 0}
        >
          ◀ 幀
        </Button>
        <Button
          variant="primary"
          className="min-h-11 flex-[1.4]"
          onClick={togglePlay}
          disabled={durationMs <= 0}
        >
          {playing ? '⏸ 暫停' : '▶ 播放'}
        </Button>
        <Button
          className="min-h-11 flex-1"
          onClick={() => stepFrame(1)}
          disabled={durationMs <= 0}
        >
          幀 ▶
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <span className="font-mono text-sm tabular-nums text-white/90">
          <span ref={timeRef}>00:00.00</span>
          <span className="text-white/35"> / {formatTime(durationMs)}</span>
        </span>

        <div className="ml-auto flex items-center gap-1">
          <span className="text-[11px] text-white/40">速度</span>
          {RATES.map((r) => (
            <Button key={r} className="px-2.5" active={rate === r} onClick={() => setRate(r)}>
              {r}x
            </Button>
          ))}
        </div>
      </div>

      {/*
        裝置解不動兩支影片時會反覆停頓,但畫面上看不出原因。
        與其讓人以為是網站壞了,不如講清楚並給可行的解法。
      */}
      {syncStrained && (
        <p className="rounded-md bg-amber-400/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-200/90 ring-1 ring-amber-400/30">
          這台裝置同時解碼兩支影片有點吃力,其中一支可能會卡頓。
          可以把其中一支換成解析度低一點的檔案,或把不用看的那支音量調到 0。
        </p>
      )}

      {/* 小螢幕上沒有實體鍵盤,這行提示只會佔掉舞台的空間 */}
      {wide && (
        <p className="text-[11px] text-white/30">
          空白鍵播放/暫停 · ←→ 逐幀 · Home 回到開頭 · M 鏡像 B(Shift+M 鏡像 A)
        </p>
      )}
    </div>
  )
}
