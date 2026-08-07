/**
 * 播放時間的精確來源。
 *
 * 刻意放在 store 外面。播放時這個值每幀都在變,如果直接放 zustand,
 * 每幀的 set 都會讓所有訂閱者重新渲染 —— 一秒 60 次的 React reconciliation
 * 會跟影片解碼搶 main thread,畫面就開始卡。
 *
 * 所以分成兩層:
 *   這裡      每幀更新,給 rAF 迴圈直接讀(播放頭、時間顯示、播放引擎)
 *   store     節流成 10Hz,只給需要 React 重新渲染的東西用(標註顯示與否)
 *
 * 使用者拖時間軸時,store 的 seek() 會同時寫這裡,兩邊不會分岔。
 */
export const playbackClock = {
  currentMs: 0,
}
