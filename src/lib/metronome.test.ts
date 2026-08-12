import { describe, expect, it } from 'vitest'
import { isAccent } from './metronome'

/** 把 0-based 的 index 換成人在數的第幾拍 */
const accentedBeats = (count: number) =>
  Array.from({ length: count }, (_, i) => i)
    .filter(isAccent)
    .map((i) => i + 1)

describe('isAccent', () => {
  it('重音落在第 4、8、12、16 拍', () => {
    expect(accentedBeats(16)).toEqual([4, 8, 12, 16])
  })

  it('第一拍不是重音', () => {
    // 數 5、6、7、8 的時候「8」才是「下一拍就要進」的提示,
    // 重音放在開頭反而跟接下來的動作對不上
    expect(isAccent(0)).toBe(false)
  })

  it('不管幾拍的預備拍,最後一聲一定是重音', () => {
    // 最後一聲正好落在歌曲第一個重拍的前一拍,那是最重要的提示
    for (const beats of [4, 8, 16]) {
      expect(isAccent(beats - 1)).toBe(true)
    }
  })

  it('4 拍的預備拍只有最後一聲是重音', () => {
    expect(accentedBeats(4)).toEqual([4])
  })

  it('8 拍的預備拍重音在 4 和 8', () => {
    expect(accentedBeats(8)).toEqual([4, 8])
  })
})
