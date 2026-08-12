import { describe, expect, it } from 'vitest'
import { encodeWav } from './wav'

/** 最小的 AudioBuffer 替身。Node 沒有 Web Audio,但 encodeWav 只用到這幾個成員。 */
function fakeBuffer(channels: Float32Array[], sampleRate = 44100): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate,
    duration: channels[0].length / sampleRate,
    getChannelData: (i: number) => channels[i],
  } as unknown as AudioBuffer
}

async function parse(blob: Blob) {
  const view = new DataView(await blob.arrayBuffer())
  const text = (o: number, n: number) =>
    String.fromCharCode(...new Uint8Array(view.buffer, o, n))
  return {
    riff: text(0, 4),
    wave: text(8, 4),
    fmt: text(12, 4),
    audioFormat: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    dataTag: text(36, 4),
    dataBytes: view.getUint32(40, true),
    riffSize: view.getUint32(4, true),
    totalBytes: view.byteLength,
    sampleAt: (i: number) => view.getInt16(44 + i * 2, true),
  }
}

describe('encodeWav', () => {
  it('寫出合法的 WAV 表頭', async () => {
    const buf = fakeBuffer([new Float32Array(100), new Float32Array(100)], 44100)
    const w = await parse(encodeWav(buf))
    expect(w.riff).toBe('RIFF')
    expect(w.wave).toBe('WAVE')
    expect(w.fmt).toBe('fmt ')
    expect(w.dataTag).toBe('data')
    expect(w.audioFormat).toBe(1) // PCM
    expect(w.bitsPerSample).toBe(16)
    expect(w.channels).toBe(2)
    expect(w.sampleRate).toBe(44100)
  })

  it('表頭裡的長度欄位要跟實際位元組數對得起來', async () => {
    // 播放器是照這些數字讀的,算錯會變成尾巴被截掉或讀到雜訊
    const frames = 250
    const buf = fakeBuffer([new Float32Array(frames), new Float32Array(frames)])
    const w = await parse(encodeWav(buf))
    expect(w.dataBytes).toBe(frames * 2 * 2) // frames × 聲道 × 2 bytes
    expect(w.totalBytes).toBe(44 + w.dataBytes)
    expect(w.riffSize).toBe(36 + w.dataBytes)
    expect(w.byteRate).toBe(44100 * 2 * 2)
    expect(w.blockAlign).toBe(2 * 2)
  })

  it('單聲道也要正確', async () => {
    const w = await parse(encodeWav(fakeBuffer([new Float32Array(64)], 16000)))
    expect(w.channels).toBe(1)
    expect(w.sampleRate).toBe(16000)
    expect(w.byteRate).toBe(16000 * 1 * 2)
    expect(w.dataBytes).toBe(64 * 2)
  })

  it('聲道是交錯排列的,不是接在一起', async () => {
    const left = Float32Array.from([1, 1, 1])
    const right = Float32Array.from([-1, -1, -1])
    const w = await parse(encodeWav(fakeBuffer([left, right])))
    // 交錯:L R L R L R
    expect(w.sampleAt(0)).toBe(32767)
    expect(w.sampleAt(1)).toBe(-32768)
    expect(w.sampleAt(2)).toBe(32767)
    expect(w.sampleAt(3)).toBe(-32768)
  })

  it('超過 ±1 的樣本要夾住,不能溢位成反相爆音', async () => {
    // 混音疊起來很容易超過 1。不 clamp 的話 setInt16 會 wrap,
    // 最大的正值瞬間變成最大的負值,聽起來就是一聲爆裂
    const buf = fakeBuffer([Float32Array.from([2.5, -3.1, 0])])
    const w = await parse(encodeWav(buf))
    expect(w.sampleAt(0)).toBe(32767)
    expect(w.sampleAt(1)).toBe(-32768)
    expect(w.sampleAt(2)).toBe(0)
  })

  it('零長度不會爆掉', async () => {
    const w = await parse(encodeWav(fakeBuffer([new Float32Array(0)])))
    expect(w.dataBytes).toBe(0)
    expect(w.totalBytes).toBe(44)
  })

  it('MIME type 是 audio/wav', () => {
    expect(encodeWav(fakeBuffer([new Float32Array(10)])).type).toBe('audio/wav')
  })
})
