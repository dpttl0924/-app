import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { playRange, timelineMap, useProject } from '../store/useProject'
import { contentToProject, projectToContent, type TimelineMap } from '../lib/timeline'
import { ENVELOPE_HZ, type Clip, type ClipId } from '../lib/types'
import { CLIP_COLORS } from '../lib/clipColors'
import { formatTime } from '../lib/format'
import { playbackClock } from '../lib/playbackClock'
import { useMediaQuery } from '../hooks/useMediaQuery'

/** 上方的刻度尺。拖這裡是移動播放頭,拖下面的色條是移動影片。 */
const RULER_H = 22
const LANE_GAP = 8
/** 小螢幕上時間軸每矮 12px,舞台就多 24px —— 直式輸出時這個交換很划算 */
const LANE_H_COMPACT = 30
const LANE_H_WIDE = 42
const laneHeight = (compact: boolean) => (compact ? LANE_H_COMPACT : LANE_H_WIDE)
const totalHeight = (compact: boolean) => RULER_H + laneHeight(compact) * 2 + LANE_GAP
const laneTop = (index: number, laneH: number) => RULER_H + index * (laneH + LANE_GAP)

const LANE_ORDER: ClipId[] = ['a', 'b']

interface ClipDrag {
  id: ClipId
  startClientX: number
  startOffsetMs: number
  /** 拖曳期間凍結的換算比例。不凍結的話偏移一變、專案長度跟著變,手指和色條會對不上。 */
  msPerPx: number
}

/**
 * 時間軸。
 *
 * 波形用的是自動對齊算出來的同一份音量包絡 —— 分析一次,對齊和視覺化都吃它。
 * 兩條波形上下對齊時,使用者一眼就能確認自動對齊到底對了沒有。
 *
 * 互動分兩區:上方刻度尺移動播放頭,下方色條直接拖曳該支影片的時間偏移。
 * 偏移原本只能按 ±100ms 之類的按鈕調,但那是「輸入一個數字」的思維 ——
 * 對齊這種看著畫面做的事,直接抓著色條移動才對。
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
  const splitAtMs = useProject((s) => s.splitAtMs)
  const countIn = useProject((s) => s.countIn)
  const tempo = useProject((s) => s.tempo)
  const annotations = useProject((s) => s.annotations)
  const seek = useProject((s) => s.seek)
  const setPlaying = useProject((s) => s.setPlaying)
  const setOffset = useProject((s) => s.setOffset)

  const clipDrag = useRef<ClipDrag | null>(null)
  const scrubbing = useRef(false)
  const [draggingId, setDraggingId] = useState<ClipId | null>(null)
  /** 拖曳時凍結顯示長度,否則色條往右移、整條時間軸就跟著縮,看起來像在抗拒 */
  const [frozenDuration, setFrozenDuration] = useState<number | null>(null)

  const drawDuration = frozenDuration ?? durationMs
  // memo 起來,不然每次 render 都是新物件,繪製的 effect 會被迫每幀重跑
  const map = useMemo(
    () => timelineMap({ countIn, tempo, rangeInMs }),
    [countIn, tempo, rangeInMs],
  )
  const range = playRange({ rangeInMs, rangeOutMs, durationMs, countIn, tempo })

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
    if (drawDuration <= 0) return

    // 刻度尺:視覺上跟下面的軌道區分開,才看得出來哪裡能拖播放頭
    ctx.fillStyle = 'rgba(255,255,255,.05)'
    ctx.fillRect(0, 0, width, RULER_H)
    ctx.strokeStyle = 'rgba(255,255,255,.12)'
    ctx.lineWidth = 1
    const stepMs = pickTickStep(drawDuration, width)
    ctx.font = '9px system-ui'
    ctx.fillStyle = 'rgba(255,255,255,.35)'
    for (let t = 0; t <= drawDuration; t += stepMs) {
      const x = Math.round((t / drawDuration) * width) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, RULER_H - 5)
      ctx.lineTo(x, RULER_H)
      ctx.stroke()
      if (x + 26 < width) ctx.fillText(formatTime(t).slice(0, 5), x + 3, 10)
    }
    ctx.strokeStyle = 'rgba(255,255,255,.06)'
    for (let t = 0; t <= drawDuration; t += stepMs) {
      const x = Math.round((t / drawDuration) * width) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, RULER_H)
      ctx.lineTo(x, height)
      ctx.stroke()
    }

    LANE_ORDER.forEach((id, i) => {
      drawLane(
        ctx,
        clips[id],
        laneTop(i, laneH),
        width,
        drawDuration,
        laneH,
        id === draggingId,
        map,
      )
    })

    // 預備拍插在剪輯起點,不是最前面。畫在軌道上面蓋住它們,
    // 影片的色條就會被切成前後兩段 —— 那正是實際發生的事。
    if (map.countInMs > 0) {
      const x0 = (map.countInAtMs / drawDuration) * width
      const w = (map.countInMs / drawDuration) * width
      ctx.fillStyle = 'rgba(11,13,18,.9)'
      ctx.fillRect(x0, RULER_H, w, height - RULER_H)
      ctx.fillStyle = 'rgba(168,85,247,.25)'
      ctx.fillRect(x0, RULER_H, w, height - RULER_H)
      ctx.fillStyle = '#a855f7'
      ctx.fillRect(x0, RULER_H, 2, height - RULER_H)
      ctx.fillRect(x0 + w - 2, RULER_H, 2, height - RULER_H)
      if (w > 46) {
        ctx.font = '10px system-ui'
        ctx.fillStyle = 'rgba(216,180,254,.95)'
        ctx.fillText('預備拍', x0 + 5, RULER_H + 12)
      }
    }

    // 刪掉的部分壓暗。時間軸要一眼看出「匯出會拿到哪一段」。
    const inX = (range.startMs / drawDuration) * width
    const outX = (range.endMs / drawDuration) * width
    ctx.fillStyle = 'rgba(11,13,18,.8)'
    if (inX > 0) ctx.fillRect(0, RULER_H, inX, height - RULER_H)
    if (outX < width) ctx.fillRect(outX, RULER_H, width - outX, height - RULER_H)
    if (inX > 0 || outX < width) {
      ctx.fillStyle = '#34d399'
      ctx.fillRect(inX, RULER_H, 2, height - RULER_H)
      ctx.fillRect(outX - 2, RULER_H, 2, height - RULER_H)
    }

    // 待處理的切點。畫得比播放頭顯眼,因為下一步就是要靠它決定刪哪邊。
    if (splitAtMs !== null) {
      // splitAtMs 記的是內容時間,畫出來要換成專案時間
      const x = (contentToProject(splitAtMs, map) / drawDuration) * width
      ctx.fillStyle = '#f59e0b'
      ctx.fillRect(x - 1, 0, 2, height)
      ctx.beginPath()
      ctx.moveTo(x - 5, 0)
      ctx.lineTo(x + 5, 0)
      ctx.lineTo(x, 9)
      ctx.closePath()
      ctx.fill()
    }

    // 拖曳中直接把偏移量標在色條上,不用切到另一個面板才看得到數字
    if (draggingId) {
      const clip = clips[draggingId]
      if (clip) {
        const i = LANE_ORDER.indexOf(draggingId)
        const x = (contentToProject(clip.offsetMs, map) / drawDuration) * width
        const label = `${clip.offsetMs > 0 ? '+' : ''}${(clip.offsetMs / 1000).toFixed(2)}s`
        ctx.font = 'bold 11px system-ui'
        const w = ctx.measureText(label).width + 10
        const bx = Math.min(Math.max(x + 4, 2), width - w - 2)
        ctx.fillStyle = CLIP_COLORS[draggingId].edge
        ctx.fillRect(bx, laneTop(i, laneH) + 3, w, 15)
        ctx.fillStyle = '#fff'
        ctx.fillText(label, bx + 5, laneTop(i, laneH) + 14)
      }
    }
  }, [
    clips,
    drawDuration,
    width,
    height,
    laneH,
    range.startMs,
    range.endMs,
    splitAtMs,
    draggingId,
    map,
  ])

  // 播放頭直接改 DOM,不觸發 React re-render(否則整個時間軸每秒重畫 60 次)。
  // 時間讀 playbackClock 而非 store —— store 是 10Hz 的節流鏡像,拿來畫會一格一格跳。
  useEffect(() => {
    let raf = 0
    const loop = () => {
      const el = playheadRef.current
      if (el) {
        const total = frozenDuration ?? useProject.getState().durationMs
        el.style.left = `${total > 0 ? (playbackClock.currentMs / total) * 100 : 0}%`
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [frozenDuration])

  /** 這個座標落在哪一支影片的色條上?沒有的話回傳 null,代表要移動播放頭。 */
  const hitClip = (clientX: number, clientY: number): ClipId | null => {
    const el = wrapRef.current
    if (!el || drawDuration <= 0) return null
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    for (let i = 0; i < LANE_ORDER.length; i++) {
      const id = LANE_ORDER[i]
      const clip = clips[id]
      if (!clip) continue
      const top = laneTop(i, laneH)
      if (y < top || y > top + laneH) continue
      const startMs = contentToProject(clip.offsetMs, map)
      const endMs = contentToProject(clip.offsetMs + clip.durationMs, map)
      const x0 = (startMs / drawDuration) * rect.width
      const x1 = (endMs / drawDuration) * rect.width
      if (x >= x0 && x <= x1) return id
    }
    return null
  }

  const scrub = (clientX: number) => {
    const el = wrapRef.current
    if (!el || durationMs <= 0) return
    const rect = el.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    seek(pct * (frozenDuration ?? durationMs))
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setPlaying(false)

    const id = hitClip(e.clientX, e.clientY)
    if (id && clips[id]) {
      clipDrag.current = {
        id,
        startClientX: e.clientX,
        startOffsetMs: clips[id]!.offsetMs,
        msPerPx: drawDuration / (wrapRef.current?.clientWidth || 1),
      }
      setDraggingId(id)
      setFrozenDuration(durationMs)
      return
    }
    scrubbing.current = true
    scrub(e.clientX)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = clipDrag.current
    if (drag) {
      const deltaMs = (e.clientX - drag.startClientX) * drag.msPerPx
      setOffset(drag.id, drag.startOffsetMs + deltaMs)
      return
    }
    if (scrubbing.current) scrub(e.clientX)
  }

  const endPointer = () => {
    clipDrag.current = null
    scrubbing.current = false
    setDraggingId(null)
    setFrozenDuration(null)
  }

  return (
    <div className="select-none">
      <div
        ref={wrapRef}
        // touch-none:不吃掉觸控的話,在時間軸上拖曳會變成捲動頁面
        className={`relative w-full touch-none rounded-md bg-black/40 ring-1 ring-white/10 ${
          draggingId ? 'cursor-grabbing' : 'cursor-pointer'
        }`}
        style={{ height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <canvas ref={canvasRef} className="absolute inset-0" style={{ width, height }} />

        {drawDuration > 0 &&
          annotations.map((a) => (
            <div
              key={a.id}
              title={`${formatTime(a.timeMs)} ${a.text}`}
              className="pointer-events-none absolute top-0 w-[2px] bg-amber-400"
              style={{ left: `${(a.timeMs / drawDuration) * 100}%`, height: RULER_H }}
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

      <p className="mt-1 text-[11px] text-white/30">
        {draggingId
          ? `拖曳影片 ${draggingId.toUpperCase()} 調整時間偏移`
          : '拖上方刻度移動播放頭 · 拖色條移動該支影片'}
      </p>
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
  active: boolean,
  map: TimelineMap,
) {
  if (!clip) return
  const color = CLIP_COLORS[clip.id]

  // 影片在專案時間軸上的位置。橫跨預備拍插入點的話,色條會被切成兩段 ——
  // 上面那層預備拍的方塊會蓋掉中間,所以這裡直接畫整條就好。
  const startMs = contentToProject(clip.offsetMs, map)
  const endMs = contentToProject(clip.offsetMs + clip.durationMs, map)
  const x0 = (startMs / durationMs) * width
  const x1 = (endMs / durationMs) * width
  const w = Math.max(2, x1 - x0)

  ctx.fillStyle = color.bg
  ctx.fillRect(x0, top, w, laneH)
  // 兩側加邊,色條才讀得出來是「一塊可以抓的東西」
  ctx.fillStyle = color.edge
  ctx.globalAlpha = active ? 1 : 0.5
  ctx.fillRect(x0, top, 2, laneH)
  ctx.fillRect(x1 - 2, top, 2, laneH)
  ctx.globalAlpha = 1
  if (active) {
    ctx.strokeStyle = color.edge
    ctx.lineWidth = 1
    ctx.strokeRect(x0 + 0.5, top + 0.5, w - 1, laneH - 1)
  }

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
    // 專案時間 → 內容時間 → 影片自己的時間,一層都不能少
    const t0 = projectToContent((x / width) * durationMs, map) - clip.offsetMs
    const t1 = projectToContent(((x + 1) / width) * durationMs, map) - clip.offsetMs
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
