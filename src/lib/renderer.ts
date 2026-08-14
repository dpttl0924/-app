import { drawClip, slotRect } from './layout'
import { drawAudioPlaceholder } from './audioPreview'
import { CLIP_COLORS } from './clipColors'
import { projectToContent, type TimelineMap } from './timeline'
import {
  ASPECT_SIZES,
  isAudioOnly,
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
  /** 內容時間與專案時間的換算(預備拍插在剪輯起點,不是最前面) */
  map: TimelineMap
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
/**
 * 每一格的畫面來源。
 *
 * 刻意用 `CanvasImageSource` 而不是 `HTMLVideoElement`,因為現在有兩條匯出路徑:
 * MediaRecorder 走即時播放的 `<video>`,WebCodecs 走解碼出來的 canvas。
 * 兩條路共用同一個 renderFrame,才不會出現「預覽對、某一條匯出路徑錯」的情況。
 *
 * null = 這一格沒有畫面可用(還沒解碼好、或這支是純音檔)。
 */
export type FrameSources = Record<ClipId, CanvasImageSource | null>

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  state: FrameState,
  videos: FrameSources,
) {
  const { clips, mode, opacity, blend, wipe, annotations, currentMs } = state
  const size = ASPECT_SIZES[state.aspect]
  // 影片吃內容時間,標註與分割線用專案時間 —— 標註是使用者在時間軸上放的
  const contentMs = projectToContent(currentMs, state.map)

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()

  drawIfVisible(ctx, clips.a, videos.a, mode, contentMs, size)

  if (clips.b) {
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
    drawIfVisible(ctx, clips.b, videos.b, mode, contentMs, size)
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
  source: CanvasImageSource | null,
  mode: CompareMode,
  currentMs: number,
  size: ProjectSize,
) {
  if (!clip) return
  // 還沒輪到這段影片時不畫,與預覽的行為一致
  if (currentMs - clip.offsetMs < 0) return

  // 純音檔的 videoWidth/videoHeight 是 0,drawImage 對著它畫不會報錯但也畫不出東西 ——
  // 沒有任何提示的話使用者會以為壞掉了,所以換成波形佔位畫面。
  // 這個分支不需要 source,所以要排在 source 檢查前面。
  if (isAudioOnly(clip)) {
    drawAudioPlaceholder(ctx, clip, slotRect(mode, clip.id, size), CLIP_COLORS[clip.id].wave)
    return
  }
  if (!source) return
  drawClip(ctx, clip, source, mode, size)
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
