import { useState } from 'react'
import { downloadBlob, exportComposite } from '../lib/export'
import { exportWithWebCodecs } from '../lib/webcodecs/videoExport'
import { exportAudio } from '../lib/audioExport'
import { playRange, useProject } from '../store/useProject'
import { formatSeconds, formatTime } from '../lib/format'
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
  const countIn = useProject((s) => s.countIn)
  const tempo = useProject((s) => s.tempo)
  const range = playRange({ rangeInMs, rangeOutMs, durationMs, countIn, tempo })
  const aspect = useProject((s) => s.aspect)
  const size = ASPECT_SIZES[aspect]
  const [scale, setScale] = useState(2 / 3)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [audioBusy, setAudioBusy] = useState(false)
  const [audioProgress, setAudioProgress] = useState(0)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  /** 退回即時錄製的原因 —— 匯出還是成功了,所以不是 error */
  const [warn, setWarn] = useState('')

  const runAudio = async () => {
    setAudioBusy(true)
    setError('')
    setAudioProgress(0)
    try {
      const { blob } = await exportAudio(setAudioProgress)
      downloadBlob(blob, `dance-compare-${Date.now()}.wav`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '音訊匯出失敗')
    } finally {
      setAudioBusy(false)
      setAudioProgress(0)
    }
  }

  /**
   * 先試 WebCodecs 的離線編碼,不行才退回 MediaRecorder 即時錄製。
   *
   * 退路一定要留:WebCodecs 的編碼器支援度因瀏覽器而異,
   * 而且失敗的話使用者只會看到「匯出壞了」,不會知道是編碼器的問題。
   */
  const run = async () => {
    setBusy(true)
    setError('')
    setProgress(0)
    setNote('')
    setWarn('')
    try {
      const result = await exportWithWebCodecs({ scale, onProgress: setProgress })
      downloadBlob(result.blob, `dance-compare-${Date.now()}.${result.extension}`)
      const speedup = range.durationMs / result.elapsedMs
      setNote(
        `離線編碼完成:${result.frames} 格(平均 ${result.avgFps}fps)、耗時 ${(result.elapsedMs / 1000).toFixed(1)}s,` +
          `約為即時錄製的 ${speedup.toFixed(1)} 倍速(${result.choice.container.toUpperCase()} / ${result.choice.video.toUpperCase()})` +
          (result.note ? `。${result.note}` : ''),
      )
    } catch (err) {
      const reason = err instanceof Error ? err.message : '未知原因'
      setWarn(`${reason}。改用即時錄製,需要一直開著這個畫面到跑完。`)
      try {
        const { blob, extension } = await exportComposite({
          videos: { a: refs.a.current, b: refs.b.current },
          scale,
          fps: 30,
          onProgress: setProgress,
        })
        downloadBlob(blob, `dance-compare-${Date.now()}.${extension}`)
      } catch (fallbackErr) {
        setError(fallbackErr instanceof Error ? fallbackErr.message : '匯出失敗')
      }
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
        {busy ? `編碼中 ${(progress * 100).toFixed(0)}%` : '匯出影片'}
      </Button>

      {busy && (
        <div className="h-1 overflow-hidden rounded bg-white/10">
          <div
            className="h-full bg-indigo-400 transition-[width]"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}

      {note && <p className="text-[11px] leading-relaxed text-emerald-300">{note}</p>}
      {warn && <p className="text-[11px] leading-relaxed text-amber-300">{warn}</p>}
      {error && <p className="text-[11px] text-red-400">{error}</p>}

      <div className="border-t border-white/10 pt-2">
        <Button
          className="w-full"
          disabled={durationMs <= 0 || busy || audioBusy}
          onClick={() => void runAudio()}
        >
          {audioBusy ? `混音中 ${(audioProgress * 100).toFixed(0)}%` : '只匯出音訊(WAV)'}
        </Button>
        <p className="mt-1.5 text-[11px] leading-relaxed text-white/35">
          預備拍 + 歌曲,不含畫面。走離線混音,幾秒就好,
          而且不需要一直開著畫面。未壓縮,{formatSeconds(range.durationMs)} 約{' '}
          {Math.round((range.durationMs / 1000) * 44100 * 2 * 2 / 1048576)} MB。
        </p>
      </div>

      <p className="text-[11px] leading-relaxed text-white/35">
        優先走 WebCodecs 離線編碼:影格直接從檔案解碼,不必即時播放,
        所以不受「切到其他 App 就錄到空白」的限制。
        編不出來時會自動退回即時錄製,那條路才需要一直開著畫面
        (輸出長度 {formatTime(range.durationMs)})。
      </p>
    </Panel>
  )
}
