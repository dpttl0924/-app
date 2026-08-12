/**
 * 把 AudioBuffer 寫成 16-bit PCM 的 WAV。
 *
 * 自己寫檔頭而不是拉套件:WAV 的結構就是 44 bytes 的表頭加上交錯的樣本,
 * 為這件事多一個相依沒有意義。要壓縮格式的話得等 WebCodecs 的 AudioEncoder。
 */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels
  const frames = buffer.length
  const bytesPerSample = 2
  const dataBytes = frames * channels * bytesPerSample
  const out = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(out)

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk 長度
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true) // byte rate
  view.setUint16(32, channels * bytesPerSample, true) // block align
  view.setUint16(34, 8 * bytesPerSample, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)

  // 先把各聲道取出來,避免在內層迴圈重複呼叫 getChannelData
  const data: Float32Array[] = []
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c))

  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      // 夾在 ±1 之外會 wrap 成反相的爆音,一定要先 clamp
      const s = Math.max(-1, Math.min(1, data[c][i]))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      offset += 2
    }
  }

  return new Blob([out], { type: 'audio/wav' })
}
