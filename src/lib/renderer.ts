import { drawClip } from './layout'
import {
  ASPECT_SIZES,
  type Annotation,
  type AspectRatio,
  type BlendMode,
  type Clip,
  type ClipId,
  type CompareMode,
  type ProjectSize,
} from './types'

export interface FrameState {
  clips: Record<ClipId, Clip | null>
  aspect: AspectRatio
  mode: CompareMode
  opacity: number
  blend: BlendMode
  wipe: number
  annotations: Annotation[]
  currentMs: number
}

/**
 * 把一幀畫到 canvas 上。這是匯出的渲染路徑。
 *
 * 與 Stage.tsx 的 CSS 預覽刻意做成兩套實作,但幾何全部來自 layout.ts。
 * 這裡每一個分支都對應 Stage 裡的一個 CSS 屬性:
 *   globalAlpha              ↔ opacity
 *   globalCompositeOperation ↔ mix-blend-mode
 *   ctx.clip()               ↔ clip-path: inset()
 * 只要 layout.ts 沒被繞過,預覽和輸出就會一致。
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  state: FrameState,
  videos: Record<ClipId, HTMLVideoElement | null>,
) {
  const { clips, mode, opacity, blend, wipe, annotations, currentMs } = state
  const size = ASPECT_SIZES[state.aspect]

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()

  drawIfVisible(ctx, clips.a, videos.a, mode, currentMs, size)

  if (clips.b && videos.b) {
    ctx.save()
    if (mode === 'overlay') {
      ctx.globalAlpha = opacity
      if (blend === 'difference') ctx.globalCompositeOperation = 'difference'
    }
    if (mode === 'wipe') {
      ctx.beginPath()
      ctx.rect(wipe * size.w, 0, size.w - wipe * size.w, size.h)
      ctx.clip()
    }
    drawIfVisible(ctx, clips.b, videos.b, mode, currentMs, size)
    ctx.restore()
  }

  if (mode === 'wipe') {
    ctx.fillStyle = 'rgba(255,255,255,.8)'
    ctx.fillRect(wipe * size.w - 1.5, 0, 3, size.h)
  } else if (mode === 'sideBySide') {
    ctx.fillStyle = 'rgba(255,255,255,.2)'
    ctx.fillRect(size.w / 2 - 1, 0, 2, size.h)
  } else if (mode === 'stacked') {
    ctx.fillStyle = 'rgba(255,255,255,.2)'
    ctx.fillRect(0, size.h / 2 - 1, size.w, 2)
  }

  drawAnnotations(ctx, annotations, currentMs, size)
}

function drawIfVisible(
  ctx: CanvasRenderingContext2D,
  clip: Clip | null,
  video: HTMLVideoElement | null,
  mode: CompareMode,
  currentMs: number,
  size: ProjectSize,
) {
  if (!clip || !video || video.readyState < 2) return
  // 還沒輪到這段影片時不畫,與預覽的行為一致
  if (currentMs - clip.offsetMs < 0) return
  drawClip(ctx, clip, video, mode, size)
}

function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  currentMs: number,
  size: ProjectSize,
) {
  const visible = annotations.filter(
    (a) => currentMs >= a.timeMs && currentMs <= a.timeMs + a.durationMs,
  )
  if (visible.length === 0) return

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const a of visible) {
    ctx.font = `bold ${a.fontSize}px system-ui, "Noto Sans TC", "Microsoft JhengHei", sans-serif`
    ctx.fillStyle = a.color
    ctx.shadowColor = 'rgba(0,0,0,.9)'
    ctx.shadowBlur = 12
    ctx.shadowOffsetY = 2

    const lines = a.text.split('\n')
    const lineHeight = a.fontSize * 1.2
    const startY = a.y * size.h - ((lines.length - 1) * lineHeight) / 2
    lines.forEach((line, i) => {
      ctx.fillText(line, a.x * size.w, startY + i * lineHeight)
    })
  }
  ctx.restore()
}
