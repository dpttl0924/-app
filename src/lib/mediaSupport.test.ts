import { describe, expect, it } from 'vitest'
import {
  MEDIA_ACCEPT,
  describeLoadFailure,
  extensionOf,
  supportsQuickTime,
} from './mediaSupport'

/** 模擬各家瀏覽器的 canPlayType */
const safari = (type: string) =>
  /quicktime|mp4/.test(type) ? 'maybe' : ''
const chromium = (type: string) =>
  type.includes('quicktime') ? '' : type.includes('mp4') ? 'maybe' : ''

describe('extensionOf', () => {
  it('取得小寫副檔名', () => {
    expect(extensionOf('IMG_1234.MOV')).toBe('mov')
    expect(extensionOf('dance.mp4')).toBe('mp4')
  })

  it('多個點時只取最後一段', () => {
    expect(extensionOf('my.dance.take.2.mov')).toBe('mov')
  })

  it('沒有副檔名時回傳空字串', () => {
    expect(extensionOf('recording')).toBe('')
    expect(extensionOf('trailing.')).toBe('')
  })
})

describe('supportsQuickTime', () => {
  it('Safari 支援', () => {
    expect(supportsQuickTime(safari)).toBe(true)
  })

  it('Chromium 不支援', () => {
    expect(supportsQuickTime(chromium)).toBe(false)
  })
})

describe('describeLoadFailure', () => {
  it('Chromium 打不開 .mov 時,直接說明並給兩條解法', () => {
    const msg = describeLoadFailure('IMG_0042.MOV', chromium)
    expect(msg).toContain('.mov')
    expect(msg).toContain('Safari')
    expect(msg).toContain('MP4')
  })

  it('Safari 打得開容器卻仍失敗時,指向編碼問題而不是容器', () => {
    // 這種情況真正的原因通常是 HEVC,叫使用者換瀏覽器沒有用
    const msg = describeLoadFailure('IMG_0042.MOV', safari)
    expect(msg).toContain('HEVC')
    expect(msg).not.toContain('Safari')
  })

  it('.mp4 失敗時也指向編碼', () => {
    expect(describeLoadFailure('dance.mp4', chromium)).toContain('HEVC')
  })

  it('其他格式給一般性訊息,不亂猜原因', () => {
    const msg = describeLoadFailure('weird.xyz', chromium)
    expect(msg).toContain('無法讀取')
    expect(msg).not.toContain('HEVC')
  })
})

describe('MEDIA_ACCEPT', () => {
  it('同時包含 MIME 萬用字元與副檔名', () => {
    // 副檔名是為了救那些 MIME type 回報不出來的檔案,兩者缺一不可
    expect(MEDIA_ACCEPT).toContain('video/*')
    expect(MEDIA_ACCEPT).toContain('audio/*')
    expect(MEDIA_ACCEPT).toContain('.mov')
  })

  it('涵蓋 iPhone 會產生的容器', () => {
    for (const ext of ['.mov', '.mp4', '.m4a']) {
      expect(MEDIA_ACCEPT).toContain(ext)
    }
  })
})
