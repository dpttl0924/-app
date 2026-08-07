import { useState } from 'react'
import { downloadBlob, exportComposite } from '../lib/export'
import { playRange, useProject } from '../store/useProject'
import { formatTime } from '../lib/format'
import { ASPECT_SIZES } from '../lib/types'
import type { VideoRefs } from '../hooks/usePlaybackEngine'
import { Button, Field, Panel, inputClass } from './ui'

/** 編碼器普遍要求偶數尺寸,這裡的顯示要跟 export.ts 算出來的一致 */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

const SCALES = [1, 2 / 3, 0.5]

export function ExportPanel({ refs }: { refs: VideoRefs }) {
  const durationMs = useProject((s) => s.durationMs)
  const rangeInMs = useProject((s) => s.rangeInMs)
  const rangeOutMs = useProject((s) => s.rangeOutMs)
  const range = playRange({ rangeInMs, rangeOutMs, durationMs })
  const aspect = useProject((s) => s.aspect)
  const size = ASPECT_SIZES[aspect]
  const [scale, setScale] = useState(2 / 3)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  const run = async () => {
    setBusy(true)
    setError('')
    setProgress(0)
    try {
      const { blob, extension } = await exportComposite({
        videos: { a: refs.a.current, b: refs.b.current },
        scale,
        fps: 30,
        onProgress: setProgress,
      })
      downloadBlob(blob, `dance-compare-${Date.now()}.${extension}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '匯出失敗')
    } finally {
      setBusy(false)
      setProgress(0)
    }
  }

  return (
    <Panel title="匯出影片">
      <Field label="輸出解析度">
        <select
          className={inputClass}
          value={scale}
          disabled={busy}
          onChange={(e) => setScale(Number(e.target.value))}
        >
          {SCALES.map((s) => (
            <option key={s} value={s}>
              {even(size.w * s)}×{even(size.h * s)}
            </option>
          ))}
        </select>
      </Field>

      <Button
        variant="primary"
        className="w-full py-2"
        disabled={durationMs <= 0 || busy}
        onClick={() => void run()}
      >
        {busy ? `錄製中 ${(progress * 100).toFixed(0)}%` : '匯出'}
      </Button>

      {busy && (
        <div className="h-1 overflow-hidden rounded bg-white/10">
          <div
            className="h-full bg-indigo-400 transition-[width]"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      <p className="text-[11px] leading-relaxed text-white/35">
        目前走 MediaRecorder 即時錄製,匯出時間約等於輸出範圍的長度(
        {formatTime(range.durationMs)})。錄製期間請讓畫面保持開啟 ——
        切到其他 App 或鎖螢幕,瀏覽器會暫停繪製導致錄到空白。
        下一版換 WebCodecs 離線編碼就不受這個限制。
      </p>
    </Panel>
  )
}
