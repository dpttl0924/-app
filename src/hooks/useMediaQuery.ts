import { useSyncExternalStore } from 'react'

/**
 * 用 media query 決定要 render 哪一套版面。
 *
 * 這裡刻意不用「兩套都 render、再用 CSS 藏一套」的做法 ——
 * 那會讓 <input type="file"> 和 <video> 出現重複實例,
 * 檔案選擇與播放引擎的 ref 都會抓錯對象。
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false, // SSR / 首次渲染先當成手機,避免桌機版面在小螢幕上閃一下
  )
}

/** Tailwind 的 lg 斷點 */
export const DESKTOP_QUERY = '(min-width: 1024px)'
