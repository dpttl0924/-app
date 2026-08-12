import { describe, expect, it } from 'vitest'
import {
  NO_COUNT_IN,
  contentToProject,
  isInCountIn,
  projectToContent,
  relativeToCountIn,
  type TimelineMap,
} from './timeline'

/** 剪輯保留 30s 之後,前面插 4 秒預備拍 */
const map: TimelineMap = { countInMs: 4000, countInAtMs: 30_000 }

describe('內容時間 ↔ 專案時間', () => {
  it('沒有預備拍時兩者相同', () => {
    for (const t of [0, 1234, 99_999]) {
      expect(contentToProject(t, NO_COUNT_IN)).toBe(t)
      expect(projectToContent(t, NO_COUNT_IN)).toBe(t)
    }
  })

  it('插入點之前的內容不動', () => {
    // 被剪掉的開頭仍然留在時間軸上原本的位置
    expect(contentToProject(0, map)).toBe(0)
    expect(contentToProject(29_999, map)).toBe(29_999)
  })

  it('插入點之後的內容整段往後推一個預備拍', () => {
    expect(contentToProject(30_000, map)).toBe(34_000)
    expect(contentToProject(50_000, map)).toBe(54_000)
  })

  it('預備拍那段沒有對應的影片內容,凍結在插入點', () => {
    expect(projectToContent(30_000, map)).toBe(30_000)
    expect(projectToContent(32_000, map)).toBe(30_000)
    expect(projectToContent(33_999, map)).toBe(30_000)
  })

  it('走完預備拍之後接回內容', () => {
    expect(projectToContent(34_000, map)).toBe(30_000)
    expect(projectToContent(40_000, map)).toBe(36_000)
  })

  it('來回換算對得回去(預備拍以外)', () => {
    for (const t of [0, 15_000, 29_999, 30_000, 45_000, 120_000]) {
      expect(projectToContent(contentToProject(t, map), map)).toBe(t)
    }
  })

  it('isInCountIn 的邊界:含頭不含尾', () => {
    expect(isInCountIn(29_999, map)).toBe(false)
    expect(isInCountIn(30_000, map)).toBe(true)
    expect(isInCountIn(33_999, map)).toBe(true)
    expect(isInCountIn(34_000, map)).toBe(false)
  })

  it('沒開預備拍時永遠不在預備拍裡', () => {
    expect(isInCountIn(0, NO_COUNT_IN)).toBe(false)
    expect(isInCountIn(5000, { countInMs: 0, countInAtMs: 5000 })).toBe(false)
  })

  it('relativeToCountIn:播放頭剛好在插入點時是 0', () => {
    expect(relativeToCountIn(30_000, map)).toBe(0)
  })

  it('relativeToCountIn:播放頭在插入點之後,回傳正值', () => {
    expect(relativeToCountIn(32_000, map)).toBe(2000)
  })

  it('relativeToCountIn:播放頭還沒到插入點,回傳負值', () => {
    // 這是修過的 bug 的核心場景:剪過片之後插入點 > 0,
    // 播放頭若還沒到那裡,必須是負值,不能被誤判成「已經超過預備拍」
    expect(relativeToCountIn(10_000, map)).toBe(-20_000)
  })

  it('relativeToCountIn 沒開預備拍時,插入點是 0,等於原始值', () => {
    expect(relativeToCountIn(5000, NO_COUNT_IN)).toBe(5000)
  })

  it('插入點在 0 時,預備拍就在最前面', () => {
    const atStart: TimelineMap = { countInMs: 4000, countInAtMs: 0 }
    expect(contentToProject(0, atStart)).toBe(4000)
    expect(projectToContent(0, atStart)).toBe(0)
    expect(projectToContent(4000, atStart)).toBe(0)
    expect(projectToContent(5000, atStart)).toBe(1000)
  })
})
