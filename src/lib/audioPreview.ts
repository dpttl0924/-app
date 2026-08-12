import type { Rect } from './types'

/**
 * 純音檔在畫面上的佔位表示。
 *
 * A/B 兩槽除了影片也接受純音檔(例如只有參考音樂、沒有舞蹈影片時)。
 * `<video>` 讀純音檔不會出錯,`ctx.drawImage` 對著 0×0 的視訊軌畫也不會丟例外,
 * 只是什麼都畫不出來 —— 沒有任何提示的話,使用者會以為是壞掉了。
 * 這裡把已經算好的音量包絡畫成一段靜態波形當佔位畫面,順便給出「這是有內容的」的回饋。
 */

/**
 * 把整段音量包絡壓縮成固定數量的長條,每條取範圍內的峰值。
 *
 * 取峰值而不是平均,理由跟 Timeline 的波形一樣:平均會把單一個鼓點的瞬間音量抹平,
 * 縮成縮圖之後就看不出節奏的輪廓了。回傳值正規化到 0..1。
 */
export function envelopeToBars(envelope: Float32Array, barCount: number): number[] {
  if (envelope.length === 0 || barCount <= 0) return []

  let max = 0
  for (let i = 0; i < envelope.length; i++) if (envelope[i] > max) max = envelope[i]
  if (max <= 0) return new Array(barCount).fill(0)

  const bars: number[] = new Array(barCount)
  for (let x = 0; x < barCount; x++) {
    const i0 = Math.floor((x / barCount) * envelope.length)
    const i1 = Math.max(i0 + 1, Math.floor(((x + 1) / barCount) * envelope.length))
    let peak = 0
    for (let i = i0; i < i1 && i < envelope.length; i++) {
      if (envelope[i] > peak) peak = envelope[i]
    }
    bars[x] = peak / max
  }
  return bars
}

/**
 * 把佔位波形畫進 canvas 的指定矩形裡。與 Timeline 的 drawLane 是同一套邏輯,
 * 差別只在這裡畫的是整段音訊的靜態縮圖,不隨播放頭捲動。
 */
export function drawEnvelopePreview(
  ctx: CanvasRenderingContext2D,
  envelope: Float32Array | null,
  rect: Rect,
  color: string,
) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.w, rect.h)
  ctx.clip()

  if (envelope && envelope.length > 0) {
    const barCount = Math.max(1, Math.round(rect.w))
    const bars = envelopeToBars(envelope, barCount)
    const cy = rect.y + rect.h / 2
    ctx.fillStyle = color
    for (let x = 0; x < bars.length; x++) {
      const h = bars[x] * (rect.h * 0.42)
      ctx.fillRect(rect.x + x, cy - h, 1, Math.max(1, h * 2))
    }
  }

  ctx.restore()
}

/**
 * 純音檔佔位畫面的完整外觀:底色 + 波形 + 檔名。
 *
 * 唯一一份實作,CSS 預覽(Stage.tsx)與 canvas 匯出(renderer.ts)都呼叫這裡 ——
 * 節拍器音色曾經在兩條路徑各寫一份、後來只改到一邊,問題發生時完全沒有錯誤訊息,
 * 只有「聽起來/看起來不對」。同一個坑不要再踩第二次。
 */
export function drawAudioPlaceholder(
  ctx: CanvasRenderingContext2D,
  clip: { name: string; envelope: Float32Array | null },
  rect: Rect,
  color: string,
) {
  ctx.save()
  ctx.fillStyle = '#15171c'
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
  drawEnvelopePreview(ctx, clip.envelope, rect, color)

  const label = clip.name.length > 40 ? `${clip.name.slice(0, 39)}…` : clip.name
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${Math.max(14, Math.min(rect.w, rect.h) * 0.05)}px system-ui, "Noto Sans TC", "Microsoft JhengHei", sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,.6)'
  ctx.shadowColor = 'rgba(0,0,0,.6)'
  ctx.shadowBlur = 8
  ctx.fillText(`♪ ${label}`, rect.x + rect.w / 2, rect.y + rect.h / 2)
  ctx.restore()
}
