/**
 * 「內容時間」與「專案時間」之間的換算。
 *
 * 加入預備拍之後,時間軸上多了一段本來不存在的空間,於是同一個時刻有兩種說法:
 *
 *   內容時間  影片素材自己的時間軸,剪輯的起訖點也記在這上面
 *   專案時間  時間軸上看到的位置,包含插進去的預備拍
 *
 * 預備拍插在「剪輯起點」那裡,不是插在最前面。
 * 早期版本插在專案時間 0,結果剪掉開頭之後,預備拍會加在**被刪掉的那段前面** ——
 * 離要練的段落還隔著一整段不要的內容,等於沒用。
 *
 * 把插入點做成參數而不是寫死成剪輯起點,是為了之後要讓使用者自己指定位置時,
 * 這裡不用再動。
 */
export interface TimelineMap {
  /** 預備拍多長。0 = 沒開。 */
  countInMs: number
  /** 插在內容時間的哪一點。目前固定是剪輯起點。 */
  countInAtMs: number
}

export const NO_COUNT_IN: TimelineMap = { countInMs: 0, countInAtMs: 0 }

/** 內容時間 → 專案時間。插入點之後的內容整段往後推。 */
export function contentToProject(contentMs: number, map: TimelineMap): number {
  return contentMs < map.countInAtMs ? contentMs : contentMs + map.countInMs
}

/**
 * 專案時間 → 內容時間。
 * 落在預備拍那段時,內容凍結在插入點 —— 那段沒有對應的影片內容。
 */
export function projectToContent(projectMs: number, map: TimelineMap): number {
  if (projectMs < map.countInAtMs) return projectMs
  if (projectMs < map.countInAtMs + map.countInMs) return map.countInAtMs
  return projectMs - map.countInMs
}

/** 這個專案時間是不是落在預備拍裡 */
export function isInCountIn(projectMs: number, map: TimelineMap): boolean {
  return (
    map.countInMs > 0 &&
    projectMs >= map.countInAtMs &&
    projectMs < map.countInAtMs + map.countInMs
  )
}

/**
 * 專案時間 → 以預備拍插入點為原點的相對時間。
 *
 * 預備拍的 click 時間表(`countInPlan().clickTimesMs`)是從 0 開始算的,
 * 但播放頭(`playbackClock.currentMs`)是絕對專案時間。混用這兩者是
 * 剪過片之後(插入點 > 0)最容易犯的錯 —— 兩邊沒有換算過,播放頭會「看起來」
 * 永遠已經超過預備拍,排程直接被跳過,結果是完全沒聲音卻不會報錯。
 *
 * 回傳值可能是負的:播放頭還沒到插入點時,代表 click 應該再往後延。
 */
export function relativeToCountIn(projectMs: number, map: TimelineMap): number {
  return projectMs - map.countInAtMs
}
