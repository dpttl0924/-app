import { useEffect, useRef } from 'react'
import { useProject } from '../store/useProject'
import { formatTime } from '../lib/format'
import { playbackClock } from '../lib/playbackClock'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { TrimBar } from './TrimBar'
import { Button } from './ui'

/**
 * 速度拉條的範圍與級距。
 *
 * 刻意不叫 RATE_STEP —— sync.ts 裡那個是漂移校正用的 playbackRate 量化階距,
 * 跟使用者選的播放速度是兩件事,同名會害人以為改一個就好。
 */
const SPEED_MIN = 0.25
const SPEED_MAX = 1
const SPEED_STEP = 0.05

/**
 * @param inlineTrim 把剪輯直接放進速度那一行。
 *
 * 只有桌機給 true。手機那一行連時間與速度都快擠不下了,剪輯留在分頁面板裡。
 */
export function Transport({ inlineTrim = false }: { inlineTrim?: boolean } = {}) {
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

      {/*
        時間 · 剪輯 · 速度 同一行,就在時間軸正上方。
        wrap 是留給視窗變窄的:寧可讓速度那組換行,也不要把剪輯擠到看不見。
      */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-sm tabular-nums text-white/90">
          <span ref={timeRef}>00:00.00</span>
          <span className="text-white/35"> / {formatTime(durationMs)}</span>
        </span>

        {inlineTrim && <TrimBar />}

        {/*
          拉條而不是幾顆固定倍率:對動作的時候常常是在 0.4 與 0.45 之間找一個
          「看得清楚又還留著節奏」的值,固定四段給不出那個解析度。
          拉到底就是原速,所以回到 1x 仍然只要一個動作。
        */}
        <label className="ml-auto flex items-center gap-2">
          <span className="text-[11px] whitespace-nowrap text-white/40">速度</span>
          <input
            type="range"
            className="h-6 w-24 touch-none sm:w-32"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={SPEED_STEP}
            value={rate}
            disabled={durationMs <= 0}
            // range 給的值會有 0.45000000000000001 這種浮點殘渣,進 store 之前先收乾淨
            onChange={(e) => setRate(Number(Number(e.target.value).toFixed(2)))}
          />
          {/* 固定寬度 + tabular-nums:拖的時候讀數不會把旁邊的東西推來推去 */}
          <span className="w-11 shrink-0 text-right font-mono text-xs tabular-nums text-white/80">
            {rate.toFixed(2)}x
          </span>
        </label>
      </div>

      {/*
        裝置解不動兩支影片時會反覆停頓,但畫面上看不出原因。
        與其讓人以為是網站壞了,不如講清楚並給可行的解法。
      */}
      {syncStrained && (
        <p className="rounded-md bg-amber-400/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-200/90 ring-1 ring-amber-400/30">
          這台裝置同時解碼兩支影片有點吃力,<strong className="font-medium">預覽</strong>
          可能會頓一下。
          {/*
            這句是必要的。預覽在頓的時候,使用者唯一看得到的東西就是頓 ——
            很自然會以為匯出的檔案也一樣,然後去修根本沒壞的那一段。
            匯出是離線解碼的,跟這裡的即時解碼壓力完全無關。
          */}
          <span className="text-amber-200/60">
            {' '}
            匯出不受影響 —— 那是離線解碼,不必即時播放。
          </span>
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
