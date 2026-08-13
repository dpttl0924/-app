/**
 * 檔案選擇器與解碼支援的相容性處理。
 *
 * iPhone 錄的影片是 QuickTime 容器(.mov)裝 HEVC,這在兩個地方會出事:
 *
 *   1. 選檔階段:`accept="video/*"` 靠的是作業系統回報的 MIME type,
 *      而 .mov 常常被回報成空字串或 application/octet-stream,於是檔案被反灰選不到。
 *      解法是把副檔名也列進 accept —— MIME 猜錯時副檔名還救得回來。
 *
 *   2. 解碼階段:Chrome / Firefox / Android 都不支援 video/quicktime 與 HEVC,
 *      Safari 才支援。這個是真的解不開,只能明確告訴使用者原因與解法,
 *      不能丟一句「格式可能不支援」讓人去猜。
 */

/**
 * file input 的 accept。
 *
 * 同時列出 MIME 萬用字元與具體副檔名:前者涵蓋一般情況,
 * 後者負責救那些 MIME type 回報不出來的檔案(iPhone 的 .mov 是最常見的一個)。
 */
export const MEDIA_ACCEPT = [
  'video/*',
  'audio/*',
  '.mov',
  '.mp4',
  '.m4v',
  '.3gp',
  '.webm',
  '.mkv',
  '.avi',
  '.m4a',
  '.mp3',
  '.wav',
  '.aac',
  '.flac',
  '.ogg',
].join(',')

/** 副檔名(小寫,不含點)。沒有副檔名時回傳空字串。 */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0 || dot === fileName.length - 1) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

/** 瀏覽器解得開 QuickTime 容器嗎 */
export function supportsQuickTime(canPlayType: (type: string) => string): boolean {
  return canPlayType('video/quicktime') !== ''
}

/**
 * 檔案讀不進來時,產生一句講得清楚的錯誤訊息。
 *
 * @param canPlayType 傳進來而不是直接呼叫,是為了可以測試各種瀏覽器的組合
 */
export function describeLoadFailure(
  fileName: string,
  canPlayType: (type: string) => string,
): string {
  const ext = extensionOf(fileName)

  if (ext === 'mov' && !supportsQuickTime(canPlayType)) {
    return (
      '這個瀏覽器打不開 .mov(iPhone 錄的影片格式)。' +
      '用 Safari 開這個網頁,或先把影片轉成 MP4(H.264)。'
    )
  }

  if (ext === 'mov' || ext === 'mp4') {
    // 容器支援但仍然失敗,最常見的原因是 HEVC 編碼
    return (
      '這支影片解不開,可能是 HEVC(H.265)編碼 —— iPhone 預設就是錄這個。' +
      '手機「設定 → 相機 → 格式」改成「最相容」再錄,或先轉成 H.264。'
    )
  }

  return '無法讀取這個檔案,格式可能不支援。'
}
