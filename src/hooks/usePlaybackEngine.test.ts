import { describe, expect, it } from 'vitest'
import { pickMaster, type VideoRefs } from './usePlaybackEngine'
import type { Clip, ClipId } from '../lib/types'

/**
 * 時鐘主控的選擇。
 *
 * 這件事決定「校正的代價丟給誰」:主控永遠不會被 seek 也不會被改速度,
 * 從屬才會。丟錯邊的話,解不動的那一支會被反覆 seek —— 那就是手機上
 * 「其中一支影片一直頓」的樣子。
 */

const clip = (over: Partial<Clip> = {}): Clip => ({
  id: 'a',
  url: 'blob:test',
  name: 'test.mp4',
  durationMs: 60_000,
  width: 1280,
  height: 720,
  fps: 30,
  offsetMs: 0,
  transform: { scale: 1, offsetX: 0, offsetY: 0, mirrored: false },
  crop: null,
  volume: 1,
  envelope: null,
  onset: null,
  ...over,
})

const refs = (ready: Partial<Record<ClipId, number | null>> = {}): VideoRefs => {
  const make = (readyState: number | null) => ({
    current: readyState === null ? null : ({ readyState } as HTMLVideoElement),
  })
  return {
    a: make(ready.a === undefined ? 4 : ready.a),
    b: make(ready.b === undefined ? 4 : ready.b),
  }
}

describe('時鐘主控', () => {
  it('選解碼最吃力的那一支 —— 它撐不住被 seek', () => {
    const clips = {
      a: clip({ id: 'a', width: 1280, height: 720 }),
      b: clip({ id: 'b', width: 1920, height: 1080 }),
    }
    expect(pickMaster(refs(), clips, 0)).toBe('b')
  })

  it('反過來也一樣,跟 A/B 的順序無關', () => {
    const clips = {
      a: clip({ id: 'a', width: 1920, height: 1080 }),
      b: clip({ id: 'b', width: 1280, height: 720 }),
    }
    expect(pickMaster(refs(), clips, 0)).toBe('a')
  })

  it('解析度一樣時維持原本的順序,常見情況行為不變', () => {
    const clips = { a: clip({ id: 'a' }), b: clip({ id: 'b' }) }
    expect(pickMaster(refs(), clips, 0)).toBe('a')
  })

  it('還沒解得出畫面的不能當主控', () => {
    const clips = {
      a: clip({ id: 'a', width: 1280, height: 720 }),
      b: clip({ id: 'b', width: 1920, height: 1080 }),
    }
    // B 比較重,但它還沒 ready
    expect(pickMaster(refs({ b: 1 }), clips, 0)).toBe('a')
  })

  it('不在自己時間範圍內的不能當主控', () => {
    const clips = {
      a: clip({ id: 'a', width: 1280, height: 720 }),
      // B 更重,但第 5 秒才進場
      b: clip({ id: 'b', width: 1920, height: 1080, offsetMs: 5000 }),
    }
    expect(pickMaster(refs(), clips, 0)).toBe('a')
    expect(pickMaster(refs(), clips, 6000)).toBe('b')
  })

  it('兩支都不在範圍內時沒有主控 —— 退回牆鐘推進', () => {
    const clips = {
      a: clip({ id: 'a', durationMs: 1000 }),
      b: clip({ id: 'b', offsetMs: 5000 }),
    }
    expect(pickMaster(refs(), clips, 3000)).toBeNull()
  })

  it('量不到尺寸的素材不搶主控', () => {
    const clips = {
      a: clip({ id: 'a', width: 1280, height: 720 }),
      b: clip({ id: 'b', width: 0, height: 0 }),
    }
    expect(pickMaster(refs(), clips, 0)).toBe('a')
  })

  it('只有一支素材時就是它', () => {
    expect(pickMaster(refs({ b: null }), { a: clip(), b: null }, 0)).toBe('a')
  })
})
