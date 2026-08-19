import { describe, expect, it } from 'vitest'
import {
  averageCoverage,
  bestAspect,
  containSize,
  cssTransform,
  drawClip,
  cropFrame,
  croppedSize,
  projectDuration,
  resolveClipTime,
  slotRect,
} from './layout'
import { ASPECT_SIZES, DEFAULT_TRANSFORM, type Clip } from './types'

const LANDSCAPE = ASPECT_SIZES['16:9']
const PORTRAIT = ASPECT_SIZES['9:16']

function makeClip(patch: Partial<Clip> = {}): Clip {
  return {
    id: 'a',
    url: 'blob:test',
    name: 'test.mp4',
    durationMs: 10_000,
    width: 1920,
    height: 1080,
    fps: 30,
    offsetMs: 0,
    transform: { ...DEFAULT_TRANSFORM },
    crop: null,
    volume: 1,
    envelope: null,
    onset: null,
    ...patch,
  }
}

describe('resolveClipTime', () => {
  it('沒有偏移時,專案時間就是影片時間', () => {
    const clip = makeClip()
    expect(resolveClipTime(clip, 3000)).toEqual({ targetSec: 3, inRange: true })
  })

  it('有偏移時要減掉偏移量,不是加上去', () => {
    // 這個方向弄反的話畫面照樣會動,只是差兩倍偏移量,肉眼很難發現
    const clip = makeClip({ offsetMs: 2370 })
    expect(resolveClipTime(clip, 5370).targetSec).toBeCloseTo(3)
  })

  it('專案時間還沒輪到這段影片時,停在第一幀且標記為超出範圍', () => {
    const clip = makeClip({ offsetMs: 2500 })
    expect(resolveClipTime(clip, 1000)).toEqual({ targetSec: 0, inRange: false })
  })

  it('影片播完之後,停在最後一幀且標記為超出範圍', () => {
    const clip = makeClip({ durationMs: 10_000, offsetMs: 0 })
    expect(resolveClipTime(clip, 12_000)).toEqual({ targetSec: 10, inRange: false })
  })

  it('剛好落在頭尾邊界時算在範圍內', () => {
    const clip = makeClip({ durationMs: 10_000, offsetMs: 1000 })
    expect(resolveClipTime(clip, 1000).inRange).toBe(true)
    expect(resolveClipTime(clip, 11_000).inRange).toBe(true)
    expect(resolveClipTime(clip, 11_001).inRange).toBe(false)
  })
})

describe('projectDuration', () => {
  it('取所有影片(含偏移)的最大結束時間', () => {
    const a = makeClip({ durationMs: 10_000, offsetMs: 0 })
    const b = makeClip({ id: 'b', durationMs: 8000, offsetMs: 2370 })
    expect(projectDuration([a, b])).toBe(10_370)
  })

  it('沒有影片時是 0', () => {
    expect(projectDuration([null, null])).toBe(0)
  })
})

describe('slotRect', () => {
  it('疊加與分割線模式下兩段影片共用整個畫面', () => {
    for (const mode of ['overlay', 'wipe'] as const) {
      expect(slotRect(mode, 'a', LANDSCAPE)).toEqual(slotRect(mode, 'b', LANDSCAPE))
      expect(slotRect(mode, 'a', LANDSCAPE)).toEqual({
        x: 0,
        y: 0,
        w: LANDSCAPE.w,
        h: LANDSCAPE.h,
      })
    }
  })

  it('左右模式對半切,且不重疊', () => {
    const a = slotRect('sideBySide', 'a', LANDSCAPE)
    const b = slotRect('sideBySide', 'b', LANDSCAPE)
    expect(a.x + a.w).toBe(b.x)
    expect(a.w + b.w).toBe(LANDSCAPE.w)
  })

  it('上下模式對半切,且不重疊', () => {
    const a = slotRect('stacked', 'a', LANDSCAPE)
    const b = slotRect('stacked', 'b', LANDSCAPE)
    expect(a.y + a.h).toBe(b.y)
    expect(a.h + b.h).toBe(LANDSCAPE.h)
  })

  it('換成直式輸出時,格子要跟著轉向', () => {
    const a = slotRect('stacked', 'a', PORTRAIT)
    const b = slotRect('stacked', 'b', PORTRAIT)
    expect(a).toEqual({ x: 0, y: 0, w: 1080, h: 960 })
    expect(b).toEqual({ x: 0, y: 960, w: 1080, h: 960 })
  })
})

describe('cssTransform', () => {
  it('位移換算成格子寬高的百分比,與 canvas 路徑等價', () => {
    // 這是預覽(CSS)與匯出(canvas)一致性的關鍵換算:
    // CSS 的 translate(x%) 是相對元素自身寬度,而元素就是一整格,
    // 所以 offsetX/slot.w × slot.w 會等於 canvas 用的 offsetX
    const clip = makeClip({
      transform: { scale: 1.5, offsetX: 270, offsetY: -192, mirrored: false },
  crop: null,
    })
    const slot = slotRect('sideBySide', 'a', ASPECT_SIZES['9:16']) // 540 x 1920
    expect(cssTransform(clip, slot)).toBe('translate(50%, -10%) scale(1.5, 1.5)')
  })

  it('沒有位移時輸出 0%,不會變成 NaN', () => {
    const clip = makeClip()
    const slot = slotRect('overlay', 'a', ASPECT_SIZES['16:9'])
    expect(cssTransform(clip, slot)).toBe('translate(0%, 0%) scale(1, 1)')
  })

  it('鏡像是把 x 軸縮放取負號', () => {
    const clip = makeClip({
      transform: { ...DEFAULT_TRANSFORM, scale: 1.5, mirrored: true },
    })
    const slot = slotRect('overlay', 'a', ASPECT_SIZES['9:16'])
    expect(cssTransform(clip, slot)).toContain('scale(-1.5, 1.5)')
  })

  it('鏡像不會讓已經擺好的位置左右顛倒', () => {
    // 翻的是影片內容,不是整個版面 —— 否則使用者每按一次鏡像就要重新對位
    const base = { ...DEFAULT_TRANSFORM, offsetX: 270, offsetY: 100 }
    const slot = slotRect('sideBySide', 'a', ASPECT_SIZES['9:16'])
    const normal = cssTransform(makeClip({ transform: base }), slot)
    const mirrored = cssTransform(
      makeClip({ transform: { ...base, mirrored: true } }),
      slot,
    )
    const translateOf = (s: string) => s.match(/translate\([^)]*\)/)![0]
    expect(translateOf(mirrored)).toBe(translateOf(normal))
  })

})

/** 錄下 canvas 呼叫,用來比對兩條渲染路徑 */
function recordingContext() {
  const ops: { op: string; args: number[] }[] = []
  const push = (op: string) => (...args: number[]) => ops.push({ op, args })
  const ctx = {
    save: push('save'),
    restore: push('restore'),
    beginPath: push('beginPath'),
    rect: push('rect'),
    clip: push('clip'),
    translate: push('translate'),
    rotate: push('rotate'),
    scale: push('scale'),
    drawImage: () => ops.push({ op: 'drawImage', args: [] }),
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops }
}

const opArgs = (ops: { op: string; args: number[] }[], name: string) =>
  ops.find((o) => o.op === name)!.args

/** 從 CSS transform 字串裡把數字抓出來 */
function parseCss(css: string) {
  const t = css.match(/translate\(([-\d.]+)%, ([-\d.]+)%\)/)!
  const s = css.match(/scale\(([-\d.]+), ([-\d.]+)\)/)!
  return {
    txPercent: +t[1],
    tyPercent: +t[2],
    scaleX: +s[1],
    scaleY: +s[2],
  }
}

describe('預覽(CSS)與匯出(canvas)必須畫出同一件事', () => {
  // 這個性質是整個專案的核心宣稱,但兩條路徑是分開實作的,
  // 只有測試能保證它們不會在某次修改後悄悄分岔。
  const cases = [
    ['無變形', { ...DEFAULT_TRANSFORM }],
    ['縮放加位移', { ...DEFAULT_TRANSFORM, scale: 1.8, offsetX: 120, offsetY: -80 }],
    ['鏡像', { ...DEFAULT_TRANSFORM, mirrored: true }],
    [
      '鏡像加縮放加位移',
      { ...DEFAULT_TRANSFORM, mirrored: true, offsetX: -60, offsetY: 40, scale: 0.75 },
    ],
  ] as const

  for (const [name, transform] of cases) {
    it(name, () => {
      const clip = makeClip({ width: 1080, height: 1920, transform })
      const size = ASPECT_SIZES['9:16']
      const slot = slotRect('sideBySide', 'a', size)

      const { ctx, ops } = recordingContext()
      drawClip(ctx, clip, {} as CanvasImageSource, 'sideBySide', size)
      const css = parseCss(cssTransform(clip, slot))

      // 位移:CSS 是格子的百分比,canvas 是絕對座標(還要加上格子中心)
      const [canvasTx, canvasTy] = opArgs(ops, 'translate')
      expect((css.txPercent / 100) * slot.w + slot.x + slot.w / 2).toBeCloseTo(canvasTx)
      expect((css.tyPercent / 100) * slot.h + slot.y + slot.h / 2).toBeCloseTo(canvasTy)

      // 縮放:兩邊必須完全一樣,鏡像的負號也要一致
      const [canvasSx, canvasSy] = opArgs(ops, 'scale')
      expect(css.scaleX).toBeCloseTo(canvasSx)
      expect(css.scaleY).toBeCloseTo(canvasSy)

      // 操作順序必須是 translate → scale → 畫圖
      expect(ops.map((o) => o.op).filter((o) =>
        ['translate', 'scale', 'drawImage'].includes(o),
      )).toEqual(['translate', 'scale', 'drawImage'])
    })
  }

  it('每一格都會先裁切,放大後不會蓋到隔壁', () => {
    const clip = makeClip({ transform: { ...DEFAULT_TRANSFORM, scale: 3 } })
    const size = ASPECT_SIZES['16:9']
    const { ctx, ops } = recordingContext()
    drawClip(ctx, clip, {} as CanvasImageSource, 'sideBySide', size)
    expect(opArgs(ops, 'rect')).toEqual([0, 0, size.w / 2, size.h])
    expect(ops.some((o) => o.op === 'clip')).toBe(true)
  })
})

describe('黑邊偵測與比例建議', () => {
  // 手機用戶最典型的情境:兩支手機直拍的影片
  const portraitPair = [
    makeClip({ id: 'a', width: 1080, height: 1920 }),
    makeClip({ id: 'b', width: 1080, height: 1920 }),
  ]

  it('直式影片用疊加模式放直式輸出,剛好填滿', () => {
    expect(averageCoverage(portraitPair, 'overlay', PORTRAIT)).toBeCloseTo(1)
  })

  it('直式影片左右並排放進直式輸出,整整一半是黑邊', () => {
    // 每格變成 540x1920,直式影片以寬度為準 → 高度只用到 960,剛好一半
    expect(averageCoverage(portraitPair, 'sideBySide', PORTRAIT)).toBeCloseTo(0.5)
  })

  it('左右並排時建議方形輸出,而不是直覺上的橫式', () => {
    // 反直覺但算得出來:把正方形對半切得到 540x1080(1:2),
    // 最接近 9:16 影片的比例,所以填充率最高。
    //   9:16 輸出 → 0.500
    //   16:9 輸出 → 0.633
    //   1:1  輸出 → 0.889  ← 贏
    // 這正是需要把判斷交給程式而不是靠感覺的原因。
    expect(bestAspect(portraitPair, 'sideBySide')).toBe('1:1')
    expect(averageCoverage(portraitPair, 'sideBySide', ASPECT_SIZES['1:1'])).toBeCloseTo(
      0.889,
      2,
    )
    expect(averageCoverage(portraitPair, 'sideBySide', ASPECT_SIZES['16:9'])).toBeCloseTo(
      0.633,
      2,
    )
  })

  it('疊加模式下直式影片配直式輸出已是最佳,不會多此一舉', () => {
    expect(bestAspect(portraitPair, 'overlay')).toBe('9:16')
  })

  it('橫式影片上下堆疊時同樣是方形輸出最省黑邊', () => {
    const landscapePair = [
      makeClip({ id: 'a', width: 1920, height: 1080 }),
      makeClip({ id: 'b', width: 1920, height: 1080 }),
    ]
    expect(bestAspect(landscapePair, 'stacked')).toBe('1:1')
    expect(averageCoverage(landscapePair, 'stacked', ASPECT_SIZES['16:9'])).toBeCloseTo(0.5)
  })

  it('還沒載入影片時不做任何判斷', () => {
    expect(averageCoverage([null, null], 'sideBySide', PORTRAIT)).toBe(1)
  })
})

describe('直式輸出的常見組合', () => {
  it('直式影片放進直式輸出的上下模式,左右不會有黑邊', () => {
    // 手機拍的 1080x1920 影片,放進 9:16 輸出的上半格(1080x960)
    const clip = makeClip({ width: 1080, height: 1920 })
    const slot = slotRect('stacked', 'a', PORTRAIT)
    const fit = containSize(clip, slot)
    // 直式影片塞進扁格子,是以高度為準 —— 左右一定有黑邊,這是物理限制
    expect(fit.h).toBe(960)
    expect(fit.w).toBe(540)
  })

  it('直式影片在直式的疊加模式下剛好滿版', () => {
    const clip = makeClip({ width: 1080, height: 1920 })
    const slot = slotRect('overlay', 'a', PORTRAIT)
    expect(containSize(clip, slot)).toEqual({ w: 1080, h: 1920 })
  })
})

describe('containSize', () => {
  it('同比例時剛好填滿格子', () => {
    const clip = makeClip({ width: 1280, height: 720 })
    expect(containSize(clip, { x: 0, y: 0, w: 1920, h: 1080 })).toEqual({
      w: 1920,
      h: 1080,
    })
  })

  it('直式影片塞進橫式格子時,以高度為準留左右黑邊', () => {
    const clip = makeClip({ width: 1080, height: 1920 })
    const fit = containSize(clip, { x: 0, y: 0, w: 1920, h: 1080 })
    expect(fit.h).toBe(1080)
    expect(fit.w).toBeCloseTo(607.5)
  })

  it('還沒讀到影片尺寸時退回格子大小,不會產生 NaN', () => {
    const clip = makeClip({ width: 0, height: 0 })
    expect(containSize(clip, { x: 0, y: 0, w: 960, h: 540 })).toEqual({ w: 960, h: 540 })
  })
})

describe('裁切幾何', () => {
  const SLOT = { x: 0, y: 0, w: 1000, h: 1000 }

  /** contain 是「乘以除法的結果」,1920 × (1000/1920) 會留下浮點殘渣 */
  const expectSize = (got: { w: number; h: number }, w: number, h: number) => {
    expect(got.w).toBeCloseTo(w, 9)
    expect(got.h).toBeCloseTo(h, 9)
  }

  it('沒裁切時 containSize 跟以前一樣', () => {
    const clip = makeClip({ width: 1920, height: 1080 })
    expectSize(containSize(clip, SLOT), 1000, 562.5)
  })

  it('裁切之後 contain 的對象換成裁切區 —— 留下的那塊自動放大填滿', () => {
    // 只留中間 50% × 50%,等於 960×540 的來源
    const clip = makeClip({
      width: 1920,
      height: 1080,
      crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    })
    // 長寬比沒變,所以仍是寬度貼齊;但同樣的 1000px 現在只裝一半的內容 = 放大兩倍
    expectSize(containSize(clip, SLOT), 1000, 562.5)
    expectSize(croppedSize(clip), 960, 540)
  })

  it('裁成直的之後改成高度貼齊,不再有上下黑邊', () => {
    // 橫式原片裁出一條直的:1920×1080 取中間 20% 寬 → 384×1080
    const clip = makeClip({
      width: 1920,
      height: 1080,
      crop: { x: 0.4, y: 0, w: 0.2, h: 1 },
    })
    const fit = containSize(clip, SLOT)
    expect(fit.h).toBe(1000)
    expect(fit.w).toBeCloseTo((384 / 1080) * 1000)
  })

  it('cropFrame:沒裁切時退化成 object-fit: contain', () => {
    const clip = makeClip({ width: 1000, height: 1000 })
    const f = cropFrame(clip, SLOT)
    expect(f.view).toEqual(f.full)
    expect(f.offset).toEqual({ x: -0, y: -0 })
  })

  it('cropFrame:放大倍率與位移對得上裁切區', () => {
    const clip = makeClip({
      width: 1000,
      height: 1000,
      crop: { x: 0.25, y: 0.5, w: 0.5, h: 0.5 },
    })
    const f = cropFrame(clip, SLOT)
    // 只露出一半 → 完整影片要放到兩倍
    expect(f.full.w).toBeCloseTo(f.view.w * 2)
    expect(f.full.h).toBeCloseTo(f.view.h * 2)
    // 往左推 crop.x 個「完整寬」,往上推 crop.y 個「完整高」
    expect(f.offset.x).toBeCloseTo(-0.25 * f.full.w)
    expect(f.offset.y).toBeCloseTo(-0.5 * f.full.h)
  })

  it('cropFrame 放大後的完整影片保持原片長寬比 —— 不會被拉扁', () => {
    const clip = makeClip({
      width: 1920,
      height: 1080,
      crop: { x: 0.1, y: 0.2, w: 0.3, h: 0.7 },
    })
    const f = cropFrame(clip, SLOT)
    expect(f.full.w / f.full.h).toBeCloseTo(1920 / 1080)
  })

  it('純音檔沒有尺寸,裁切不該讓它變成 0', () => {
    const clip = makeClip({ width: 0, height: 0, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } })
    expectSize(containSize(clip, SLOT), SLOT.w, SLOT.h)
  })
})
