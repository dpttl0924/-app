import type { ClipId } from './types'

/**
 * A/B 兩支素材的識別色。
 *
 * 時間軸的波形、面板的檔名(`text-blue-300` / `text-pink-300`)、
 * 純音檔在舞台與匯出畫面上的佔位波形都共用這一組,
 * 不然「時間軸上 A 是藍色,舞台上又換一個顏色」會讓人以為是不同的東西。
 */
export const CLIP_COLORS: Record<ClipId, { wave: string; bg: string; edge: string }> = {
  a: { wave: '#60a5fa', bg: 'rgba(96,165,250,.14)', edge: '#3b82f6' },
  b: { wave: '#f472b6', bg: 'rgba(244,114,182,.14)', edge: '#ec4899' },
}
