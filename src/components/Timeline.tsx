import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { playRange, useProject } from '../store/useProject'
import { ENVELOPE_HZ, type Clip } from '../lib/types'
import { formatTime } from '../lib/format'
import { playbackClock } from '../lib/playbackClock'
import { useMediaQuery } from '../hooks/useMediaQuery'

const LANE_GAP = 8
const MARKER_H = 14
/** 小螢幕上時間軸每矮 12px,舞台就多 24px —— 直式輸出時這個交換很划算 */
const laneH_COMPACT = 30
const laneH_WIDE = 42
const laneHeight = (compact: boolean) => (compact ? laneH_COMPACT : laneH_WIDE)
const totalHeight = (compact: boolean) => MARKER_H + laneHeight(compact) * 2 + LANE_GAP

const LANE_COLORS: Record<'a' | 'b', { wave: string; bg: string }> = {
  a: { wave: '#60a5fa', bg: 'rgba(96,165,250,.12)' },
  b: { wave: '#f472b6', bg: 'rgba(244,114,182,.12)' },
}

/**
 * 時間軸。波形用的是自動對齊算出來的同一份音量包絡 ——
 * 分析一次,對齊和視覺化都吃它,不重複解碼。
 * 兩條波形上下對齊時,使用者一眼就能確認自動對齊到底對了沒有。
 */
export function Timeline() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const compact = !useMediaQuery('(min-width: 640px)')
  const laneH = laneHeight(compact)
  const height = totalHeight(compact)

  const clips = useProject((s) => s.clips)
  const durationMs = useProject((s) => s.durationMs)
  const rangeInMs = useProject((s) => s.rangeInMs)
  const rangeOutMs = useProject((s) => s.rangeOutMs)
  const range = playRange({ rangeInMs, rangeOutMs, durationMs })
  const annotations = useProject((s) => s.annotations)
  const seek = useProject((s) => s.seek)
  const setPlaying = useProject((s) => s.setPlaying)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // 波形只在資料變動時重畫,不跟著播放頭每幀重畫
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    if (durationMs <= 0) return

    drawLane(ctx, clips.a, MARKER_H, width, durationMs, laneH)
    drawLane(ctx, clips.b, MARKER_H + laneH + LANE_GAP, width, durationMs, laneH)

    ctx.strokeStyle = 'rgba(255,255,255,.08)'
    ctx.lineWidth = 1
    const stepMs = pickTickStep(durationMs, width)
    for (let t = 0; t <= durationMs; t += stepMs) {
      const x = Math.round((t / durationMs) * width) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, MARKER_H)
      ctx.lineTo(x, height)
      ctx.stroke()
    }

    // 輸出範圍外的部分壓暗。時間軸要一眼看出「匯出會拿到哪一段」。
    const inX = (range.startMs / durationMs) * width
    const outX = (range.endMs / durationMs) * width
    ctx.fillStyle = 'rgba(11,13,18,.72)'
    if (inX > 0) ctx.fillRect(0, MARKER_H, inX, height - MARKER_H)
    if (outX < width) ctx.fillRect(outX, MARKER_H, width - outX, height - MARKER_H)

    if (inX > 0 || outX < width) {
      ctx.fillStyle = '#34d399'
      ctx.fillRect(inX, MARKER_H, 2, height - MARKER_H)
      ctx.fillRect(outX - 2, MARKER_H, 2, height - MARKER_H)
    }
  }, [clips, durationMs, width, height, laneH, range.startMs, range.endMs])

  // 播放頭直接改 DOM,不觸發 React re-render(否則整個時間軸每秒重畫 60 次)。
  // 時間讀 playbackClock 而非 store —— store 是 10Hz 的節流鏡像,拿來畫會一格一格跳。
  useEffect(() => {
    let raf = 0
    const loop = () => {
      const { durationMs } = useProject.getState()
      const el = playheadRef.current
      if (el) {
        const pct =
          durationMs > 0 ? (playbackClock.currentMs / durationMs) * 100 : 0
        el.style.left = `${pct}%`
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const scrub = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = wrapRef.current
    if (!el || durationMs <= 0) return
    const rect = el.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    seek(pct * durationMs)
  }

  const dragging = useRef(false)

  return (
    <div className="select-none">
      <div
        ref={wrapRef}
        // touch-none:不吃掉觸控的話,在時間軸上拖曳會變成捲動頁面
        className="relative w-full cursor-pointer touch-none rounded-md bg-black/40 ring-1 ring-white/10"
        style={{ height }}
        onPointerDown={(e) => {
          dragging.current = true
          setPlaying(false)
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          scrub(e)
        }}
        onPointerMove={(e) => dragging.current && scrub(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />

        {durationMs > 0 &&
          annotations.map((a) => (
            <div
              key={a.id}
              title={`${formatTime(a.timeMs)} ${a.text}`}
              className="pointer-events-none absolute top-0 w-[2px] bg-amber-400"
              style={{ left: `${(a.timeMs / durationMs) * 100}%`, height: MARKER_H }}
            >
              <div className="absolute -left-[3px] top-0 h-2 w-2 rounded-full bg-amber-400" />
            </div>
          ))}

        <div
          ref={playheadRef}
          className="pointer-events-none absolute top-0 h-full w-[2px] bg-white"
          style={{ left: 0 }}
        >
          <div className="absolute -left-[5px] top-0 h-3 w-3 rounded-sm bg-white" />
        </div>
      </div>

      {/* 小螢幕上省掉這行,空間留給舞台;波形顏色在「影片」面板裡已經標了 */}
      {!compact && (
        <div className="mt-1 flex justify-between text-[11px] text-white/40">
          <span>A(藍)· {clips.a?.name ?? '未載入'}</span>
          <span>B(粉)· {clips.b?.name ?? '未載入'}</span>
        </div>
      )}
    </div>
  )
}

function drawLane(
  ctx: CanvasRenderingContext2D,
  clip: Clip | null,
  top: number,
  width: number,
  durationMs: number,
  laneH: number,
) {
  if (!clip) return
  const color = LANE_COLORS[clip.id]

  // 影片佔用的時間範圍
  const x0 = (clip.offsetMs / durationMs) * width
  const x1 = ((clip.offsetMs + clip.durationMs) / durationMs) * width
  ctx.fillStyle = color.bg
  ctx.fillRect(x0, top, Math.max(1, x1 - x0), laneH)

  const env = clip.envelope
  if (!env || env.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,.3)'
    ctx.font = '11px system-ui'
    ctx.fillText('音訊分析中…', x0 + 6, top + laneH / 2 + 4)
    return
  }

  let max = 0
  for (let i = 0; i < env.length; i++) if (env[i] > max) max = env[i]
  if (max <= 0) return

  const msPerSample = 1000 / ENVELOPE_HZ
  const cy = top + laneH / 2
  ctx.fillStyle = color.wave

  for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) {
    // 一個像素可能橫跨多個取樣點,取這段裡的峰值才不會漏掉重拍
    const t0 = (x / width) * durationMs - clip.offsetMs
    const t1 = ((x + 1) / width) * durationMs - clip.offsetMs
    const i0 = Math.max(0, Math.floor(t0 / msPerSample))
    const i1 = Math.min(env.length, Math.max(i0 + 1, Math.ceil(t1 / msPerSample)))
    let peak = 0
    for (let i = i0; i < i1; i++) if (env[i] > peak) peak = env[i]
    const h = (peak / max) * (laneH / 2 - 2)
    ctx.fillRect(x, cy - h, 1, Math.max(1, h * 2))
  }
}

function pickTickStep(durationMs: number, width: number): number {
  const candidates = [1000, 2000, 5000, 10_000, 30_000, 60_000, 300_000]
  const minPx = 60
  for (const c of candidates) {
    if ((c / durationMs) * width >= minPx) return c
  }
  return candidates[candidates.length - 1]
}
