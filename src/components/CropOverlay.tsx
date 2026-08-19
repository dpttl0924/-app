import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { containSize } from '../lib/layout'
import {
  CROP_HANDLES,
  cropOrFull,
  normaliseCrop,
  orientCrop,
  resizeCrop,
  type CropHandle,
} from '../lib/crop'
import type { Clip, ProjectSize, Rect } from '../lib/types'

/**
 * 裁切框:八個控制點 + 整塊搬移。
 *
 * 裁切期間刻意顯示**完整的原片**(見 Stage 的 cropping 分支),而不是即時
 * 套用裁切的結果 —— 照片裁切工具都是這樣:要選「留哪一塊」,就得先看得到全部,
 * 邊拉邊放大的話等於在移動的目標上瞄準。放大填滿是按完成之後才發生的事。
 *
 * 因此這裡的座標對應非常單純:overlay 的根元素就等於影片在畫面上佔的矩形,
 * 拉框時直接用它的 getBoundingClientRect() 換算,不需要知道舞台多大。
 */
export function CropOverlay({
  clip,
  slot,
  size,
  onChange,
}: {
  clip: Clip
  slot: Rect
  size: ProjectSize
  onChange: (crop: ReturnType<typeof normaliseCrop>) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    handle: CropHandle
    start: ReturnType<typeof cropOrFull>
    x: number
    y: number
  } | null>(null)

  const mirrored = clip.transform.mirrored
  // 存的是原片座標,畫的是畫面座標 —— 鏡像時左右要對調
  const shown = orientCrop(cropOrFull(clip.crop), mirrored)

  // 裁切期間影片沒有裁切也沒有縮放位移,所以它就是「整片 contain 進格子」
  const fit = containSize({ ...clip, crop: null }, slot)
  const pct = (v: number) => `${v * 100}%`

  const onDown = (e: ReactPointerEvent<HTMLElement>, handle: CropHandle) => {
    // 不讓事件冒到舞台,否則會被當成拖曳標註或手勢調整
    e.stopPropagation()
    e.preventDefault()
    rootRef.current?.setPointerCapture(e.pointerId)
    drag.current = { handle, start: shown, x: e.clientX, y: e.clientY }
  }

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const el = rootRef.current
    if (!d || !el) return
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return
    const next = resizeCrop(
      d.start,
      d.handle,
      (e.clientX - d.x) / r.width,
      (e.clientY - d.y) / r.height,
    )
    onChange(normaliseCrop(orientCrop(next, mirrored)))
  }

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null
    rootRef.current?.releasePointerCapture?.(e.pointerId)
  }

  return (
    <div
      ref={rootRef}
      className="absolute touch-none"
      style={{
        // 影片在格子裡置中 contain 之後的位置,換算成整個舞台的百分比
        left: pct((slot.x + (slot.w - fit.w) / 2) / size.w),
        top: pct((slot.y + (slot.h - fit.h) / 2) / size.h),
        width: pct(fit.w / size.w),
        height: pct(fit.h / size.h),
      }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {/* 框外壓暗。用四塊而不是一個大 box-shadow,縮放時邊界才不會有毛邊 */}
      <Shade style={{ left: 0, top: 0, width: '100%', height: pct(shown.y) }} />
      <Shade
        style={{
          left: 0,
          top: pct(shown.y + shown.h),
          width: '100%',
          height: pct(1 - shown.y - shown.h),
        }}
      />
      <Shade
        style={{ left: 0, top: pct(shown.y), width: pct(shown.x), height: pct(shown.h) }}
      />
      <Shade
        style={{
          left: pct(shown.x + shown.w),
          top: pct(shown.y),
          width: pct(1 - shown.x - shown.w),
          height: pct(shown.h),
        }}
      />

      {/* 保留區:整塊可拖曳搬移 */}
      <div
        className="absolute cursor-move ring-2 ring-indigo-400"
        style={{
          left: pct(shown.x),
          top: pct(shown.y),
          width: pct(shown.w),
          height: pct(shown.h),
        }}
        onPointerDown={(e) => onDown(e, 'move')}
      >
        {/* 三分法輔助線 —— 對舞蹈構圖很有用,而且看得出框確實在動 */}
        <div className="pointer-events-none absolute inset-0 opacity-40">
          <div className="absolute top-1/3 h-px w-full bg-white" />
          <div className="absolute top-2/3 h-px w-full bg-white" />
          <div className="absolute left-1/3 h-full w-px bg-white" />
          <div className="absolute left-2/3 h-full w-px bg-white" />
        </div>
      </div>

      {CROP_HANDLES.map((h) => (
        <button
          key={h}
          aria-label={`裁切控制點 ${h}`}
          onPointerDown={(e) => onDown(e, h)}
          className="absolute rounded-full border-2 border-indigo-300 bg-white shadow"
          style={{
            // 觸控目標比視覺大小重要,手機上 6px 的點根本按不到
            width: 16,
            height: 16,
            marginLeft: -8,
            marginTop: -8,
            cursor: `${h}-resize`,
            left: pct(shown.x + handleU(h) * shown.w),
            top: pct(shown.y + handleV(h) * shown.h),
          }}
        />
      ))}
    </div>
  )
}

function Shade({ style }: { style: React.CSSProperties }) {
  return <div className="pointer-events-none absolute bg-black/60" style={style} />
}

/** 控制點在框裡的相對位置:w=0、e=1,其餘置中 */
const handleU = (h: CropHandle) => (h.includes('w') ? 0 : h.includes('e') ? 1 : 0.5)
const handleV = (h: CropHandle) => (h.includes('n') ? 0 : h.includes('s') ? 1 : 0.5)
