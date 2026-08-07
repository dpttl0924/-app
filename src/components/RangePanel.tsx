import { playRange, useProject } from '../store/useProject'
import { formatSeconds, formatTime } from '../lib/format'
import { Button, Panel } from './ui'

/**
 * 輸出範圍。
 *
 * 刻意做成專案層級、兩支影片一起套用,而不是每支影片各自裁切 ——
 * 各自裁的話,為了不破壞對齊必須把裁過的那支往後推同樣的時間,
 * 結果前面多出一段只有靜止畫格的死區,專案也沒有變短。
 */
export function RangePanel() {
  const durationMs = useProject((s) => s.durationMs)
  const rangeInMs = useProject((s) => s.rangeInMs)
  const rangeOutMs = useProject((s) => s.rangeOutMs)
  const setRangeToPlayhead = useProject((s) => s.setRangeToPlayhead)
  const clearRange = useProject((s) => s.clearRange)
  const seek = useProject((s) => s.seek)
  const setPlaying = useProject((s) => s.setPlaying)

  const range = playRange({ rangeInMs, rangeOutMs, durationMs })
  const trimmed = range.startMs > 0 || range.endMs < durationMs
  const disabled = durationMs <= 0

  const jump = (ms: number) => {
    setPlaying(false)
    seek(ms)
  }

  return (
    <Panel
      title="輸出範圍"
      right={
        trimmed ? (
          <Button variant="ghost" onClick={clearRange}>
            全選
          </Button>
        ) : null
      }
    >
      <div className="flex items-center justify-between text-[11px]">
        <button
          className="font-mono tabular-nums text-emerald-300 hover:underline"
          disabled={disabled}
          onClick={() => jump(range.startMs)}
        >
          {formatTime(range.startMs)}
        </button>
        <span className="text-white/40">
          共 {formatSeconds(range.durationMs)}
          {trimmed && <span className="text-white/25"> / {formatTime(durationMs)}</span>}
        </span>
        <button
          className="font-mono tabular-nums text-emerald-300 hover:underline"
          disabled={disabled}
          onClick={() => jump(range.endMs)}
        >
          {formatTime(range.endMs)}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1">
        <Button disabled={disabled} onClick={() => setRangeToPlayhead('in')}>
          起點設為現在
        </Button>
        <Button disabled={disabled} onClick={() => setRangeToPlayhead('out')}>
          訖點設為現在
        </Button>
      </div>

      <p className="text-[11px] leading-relaxed text-white/35">
        把播放頭移到要的位置再按。時間軸上範圍外的部分會變暗,
        播放也只會在範圍內跑 —— 預覽看到的就是匯出會拿到的東西。
        兩支影片一起套用,所以不會影響已經對好的同步。
      </p>
    </Panel>
  )
}
