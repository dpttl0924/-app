/** 00:12.34 這種格式。負數會加上減號。 */
export function formatTime(ms: number): string {
  const sign = ms < 0 ? '-' : ''
  const total = Math.abs(ms)
  const m = Math.floor(total / 60000)
  const s = Math.floor((total % 60000) / 1000)
  const cs = Math.floor((total % 1000) / 10)
  return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`
}
