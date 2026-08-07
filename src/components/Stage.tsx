import { useRef } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { cssTransform, slotRect } from '../lib/layout'
import {
  ASPECT_SIZES,
  type Clip,
  type ClipId,
  type CompareMode,
  type ProjectSize,
  type Rect,
} from '../lib/types'
import { useProject } from '../store/useProject'
import type { VideoRefs } from '../hooks/usePlaybackEngine'

interface StageProps {
  refs: VideoRefs
}

/** 手勢中的暫存狀態。放在 ref 裡,不進 React state,避免每次移動都 re-render。 */
interface GestureState {
  pointers: Map<number, { x: number; y: number }>
  startDistance: number
  startScale: number
  startOffsetX: number
  startOffsetY: number
  startCenter: { x: number; y: number }
}

/**
 * 舞台完全由 CSS 決定尺寸,沒有任何 JS 測量參與畫面正確性。
 *
 * 原本是用 ResizeObserver 量出縮放倍率再套 transform: scale(),
 * 但手機上旋轉螢幕、網址列收合、鍵盤彈出都會改變可用高度,
 * 只要有一次通知沒送到,整個畫面就會停在錯的比例。
 *
 * 改法:方框大小用 container query 單位做 contain-fit,
 * 內部所有位置與尺寸都用百分比(字級用 cqw)表示。
 * 幾何數字仍然全部來自 layout.ts,只是在寫進 CSS 前換算成相對單位。
 */
export function Stage({ refs }: StageProps) {
  const boxRef = useRef<HTMLDivElement>(null)

  const clips = useProject((s) => s.clips)
  const aspect = useProject((s) => s.aspect)
  const mode = useProject((s) => s.mode)
  const opacity = useProject((s) => s.opacity)
  const blend = useProject((s) => s.blend)
  const wipe = useProject((s) => s.wipe)
  const annotations = useProject((s) => s.annotations)
  const currentMs = useProject((s) => s.currentMs)
  const selected = useProject((s) => s.selectedAnnotation)
  const adjustTarget = useProject((s) => s.adjustTarget)
  const updateAnnotation = useProject((s) => s.updateAnnotation)
  const selectAnnotation = useProject((s) => s.selectAnnotation)
  const setTransform = useProject((s) => s.setTransform)

  const size = ASPECT_SIZES[aspect]

  const annotationDrag = useRef<string | null>(null)
  const gesture = useRef<GestureState | null>(null)

  /** 螢幕像素 → 專案座標系像素。每次都現算,不會有過期的縮放倍率。 */
  const toProject = (px: number) => {
    const boxWidth = boxRef.current?.clientWidth
    return boxWidth ? (px * size.w) / boxWidth : 0
  }

  const onAnnotationPointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    id: string,
  ) => {
    e.stopPropagation()
    selectAnnotation(id)
    annotationDrag.current = id
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  /** 用目前留在畫面上的手指重新取基準,避免手指增減時畫面跳動 */
  const rebase = (g: GestureState, clip: Clip) => {
    const pts = [...g.pointers.values()]
    g.startScale = clip.transform.scale
    g.startOffsetX = clip.transform.offsetX
    g.startOffsetY = clip.transform.offsetY
    g.startCenter = centroid(pts)
    g.startDistance = pts.length >= 2 ? distance(pts[0], pts[1]) : 0
  }

  const onStagePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const clip = adjustTarget ? clips[adjustTarget] : null
    if (!clip) return
    e.currentTarget.setPointerCapture(e.pointerId)

    const g: GestureState = gesture.current ?? {
      pointers: new Map(),
      startDistance: 0,
      startScale: clip.transform.scale,
      startOffsetX: clip.transform.offsetX,
      startOffsetY: clip.transform.offsetY,
      startCenter: { x: e.clientX, y: e.clientY },
    }
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    rebase(g, clip)
    gesture.current = g
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = boxRef.current
    if (!box) return

    if (annotationDrag.current) {
      const rect = box.getBoundingClientRect()
      updateAnnotation(annotationDrag.current, {
        x: clamp01((e.clientX - rect.left) / rect.width),
        y: clamp01((e.clientY - rect.top) / rect.height),
      })
      return
    }

    const g = gesture.current
    const clip = adjustTarget ? clips[adjustTarget] : null
    if (!g || !clip || !g.pointers.has(e.pointerId)) return

    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...g.pointers.values()]
    const center = centroid(pts)

    const patch: { offsetX: number; offsetY: number; scale?: number } = {
      offsetX: g.startOffsetX + toProject(center.x - g.startCenter.x),
      offsetY: g.startOffsetY + toProject(center.y - g.startCenter.y),
    }
    if (pts.length >= 2 && g.startDistance > 0) {
      patch.scale = clamp(g.startScale * (distance(pts[0], pts[1]) / g.startDistance), 0.2, 4)
    }
    setTransform(clip.id, patch)
  }

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    annotationDrag.current = null
    const g = gesture.current
    if (!g) return
    g.pointers.delete(e.pointerId)
    if (g.pointers.size === 0) {
      gesture.current = null
      return
    }
    const clip = adjustTarget ? clips[adjustTarget] : null
    if (clip) rebase(g, clip)
  }

  const visible = annotations.filter(
    (a) => currentMs >= a.timeMs && currentMs <= a.timeMs + a.durationMs,
  )

  return (
    <div
      className="grid min-h-0 w-full flex-1 place-items-center"
      // container-type: size 讓方框可以用 cqw / cqh 取得這個容器的尺寸
      style={{ containerType: 'size' }}
    >
      <div
        ref={boxRef}
        className="relative overflow-hidden rounded-lg bg-black ring-1 ring-white/10"
        style={{
          // 純 CSS 的 contain-fit:寬度取「容器寬」與「容器高換算成等比寬」的較小值
          width: `min(100cqw, calc(100cqh * ${size.w} / ${size.h}))`,
          aspectRatio: `${size.w} / ${size.h}`,
          // 方框自己也是一個 container,裡面的 cqw 就是方框寬度,字級靠它縮放
          containerType: 'inline-size',
          // 調整模式下吃掉觸控手勢,否則拖曳影片會連帶捲動頁面。
          // 沒在調整時維持 auto,讓使用者可以正常滑動頁面。
          touchAction: adjustTarget ? 'none' : 'auto',
        }}
        onPointerDown={onStagePointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <ClipLayer clip={clips.a} videoRef={refs.a} mode={mode} size={size} />
        <ClipLayer
          clip={clips.b}
          videoRef={refs.b}
          mode={mode}
          size={size}
          style={{
            opacity: mode === 'overlay' ? opacity : 1,
            mixBlendMode:
              mode === 'overlay' && blend === 'difference' ? 'difference' : 'normal',
            clipPath: mode === 'wipe' ? `inset(0 0 0 ${wipe * 100}%)` : undefined,
          }}
        />

        {mode === 'wipe' && (
          <div
            className="pointer-events-none absolute top-0 h-full w-[3px] bg-white/80"
            style={{ left: `${wipe * 100}%` }}
          />
        )}

        {(mode === 'sideBySide' || mode === 'stacked') && (
          <div
            className={`pointer-events-none absolute bg-white/20 ${
              mode === 'sideBySide' ? 'top-0 h-full w-0.5' : 'left-0 h-0.5 w-full'
            }`}
            style={mode === 'sideBySide' ? { left: '50%' } : { top: '50%' }}
          />
        )}

        {adjustTarget && clips[adjustTarget] && (
          <AdjustHighlight
            slot={slotRect(mode, adjustTarget, size)}
            size={size}
            label={adjustTarget.toUpperCase()}
          />
        )}

        {visible.map((a) => (
          <div
            key={a.id}
            onPointerDown={(e) => onAnnotationPointerDown(e, a.id)}
            className={`absolute max-w-[90%] cursor-move touch-none whitespace-pre-wrap p-[2%] text-center font-bold select-none ${
              selected === a.id ? 'ring-2 ring-indigo-400' : ''
            }`}
            style={{
              left: `${a.x * 100}%`,
              top: `${a.y * 100}%`,
              transform: 'translate(-50%, -50%)',
              color: a.color,
              // 字級跟著方框寬度縮放,cqw 就是方框自己的寬度
              fontSize: `calc(${a.fontSize / size.w} * 100cqw)`,
              lineHeight: 1.2,
              textShadow: '0 2px 12px rgba(0,0,0,.9), 0 0 3px rgba(0,0,0,.9)',
            }}
          >
            {a.text}
          </div>
        ))}

        {!clips.a && !clips.b && (
          <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-white/40">
            載入兩段影片後開始對比
          </div>
        )}
      </div>
    </div>
  )
}

/** 調整模式下標出目前操作的是哪一格。框線用螢幕像素,縮小時才不會細到看不見。 */
function AdjustHighlight({
  slot,
  size,
  label,
}: {
  slot: Rect
  size: ProjectSize
  label: string
}) {
  return (
    <div
      className="pointer-events-none absolute border-2 border-indigo-400"
      style={{
        left: `${(slot.x / size.w) * 100}%`,
        top: `${(slot.y / size.h) * 100}%`,
        width: `${(slot.w / size.w) * 100}%`,
        height: `${(slot.h / size.h) * 100}%`,
      }}
    >
      <span className="absolute left-1 top-1 rounded bg-indigo-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
        調整中 {label}
      </span>
    </div>
  )
}

interface ClipLayerProps {
  clip: Clip | null
  videoRef: VideoRefs[ClipId]
  mode: CompareMode
  size: ProjectSize
  style?: CSSProperties
}

function ClipLayer({ clip, videoRef, mode, size, style }: ClipLayerProps) {
  if (!clip) return null
  const slot = slotRect(mode, clip.id, size)

  return (
    <div
      className="absolute overflow-hidden"
      style={{
        left: `${(slot.x / size.w) * 100}%`,
        top: `${(slot.y / size.h) * 100}%`,
        width: `${(slot.w / size.w) * 100}%`,
        height: `${(slot.h / size.h) * 100}%`,
        ...style,
      }}
    >
      <video
        ref={videoRef}
        src={clip.url}
        playsInline
        preload="auto"
        className="pointer-events-none h-full w-full"
        style={{ objectFit: 'contain', transform: cssTransform(clip, slot) }}
      />
    </div>
  )
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

function centroid(pts: { x: number; y: number }[]) {
  const sum = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 })
  return { x: sum.x / pts.length, y: sum.y / pts.length }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
