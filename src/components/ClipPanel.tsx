import { useRef, useState } from 'react'
import { useProject } from '../store/useProject'
import { formatSeconds, formatTime } from '../lib/format'
import type { ClipId } from '../lib/types'
import { Button, Field, Panel, Slider, inputClass } from './ui'

const NUDGES = [-1000, -100, -10, 10, 100, 1000]
const FPS_OPTIONS = [24, 25, 30, 50, 60]

export function ClipPanel({ id }: { id: ClipId }) {
  const clip = useProject((s) => s.clips[id])
  const loading = useProject((s) => s.loading)
  const adjusting = useProject((s) => s.adjustTarget === id)
  const setAdjustTarget = useProject((s) => s.setAdjustTarget)
  const loadClip = useProject((s) => s.loadClip)
  const removeClip = useProject((s) => s.removeClip)
  const setTransform = useProject((s) => s.setTransform)
  const resetTransform = useProject((s) => s.resetTransform)
  const toggleMirror = useProject((s) => s.toggleMirror)
  const setOffset = useProject((s) => s.setOffset)
  const nudgeOffset = useProject((s) => s.nudgeOffset)
  const setVolume = useProject((s) => s.setVolume)
  const setFps = useProject((s) => s.setFps)

  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError('')
    try {
      await loadClip(id, file)
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    }
  }

  const label = id.toUpperCase()
  const accent = id === 'a' ? 'text-blue-300' : 'text-pink-300'

  return (
    <Panel
      title={`影片 ${label}`}
      right={
        clip ? (
          <Button variant="ghost" onClick={() => removeClip(id)}>
            移除
          </Button>
        ) : null
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />

      {!clip ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            void pick(e.dataTransfer.files?.[0])
          }}
          onClick={() => fileRef.current?.click()}
          className="cursor-pointer rounded-md border border-dashed border-white/20 px-3 py-7 text-center text-xs text-white/40 hover:border-indigo-400 hover:text-white/70"
        >
          {loading === id ? '讀取中…' : `點擊選擇影片 ${label}(或拖放到這裡)`}
        </div>
      ) : (
        <>
          <div className="text-[11px] leading-relaxed">
            <div className={`truncate font-medium ${accent}`} title={clip.name}>
              {clip.name}
            </div>
            <div className="text-white/40">
              {clip.width}×{clip.height} · {formatTime(clip.durationMs)}
              {clip.envelope ? ' · 音訊已分析' : ' · 音訊分析中…'}
            </div>
          </div>

          <Field label={`時間偏移 ${formatSeconds(clip.offsetMs)}`}>
            <div className="flex flex-wrap gap-1">
              {NUDGES.map((n) => (
                <Button key={n} onClick={() => nudgeOffset(id, n)}>
                  {n > 0 ? `+${n}` : n}
                </Button>
              ))}
              <Button variant="ghost" onClick={() => setOffset(id, 0)}>
                歸零
              </Button>
            </div>
          </Field>

          <Button
            variant={clip.transform.mirrored ? 'primary' : 'default'}
            className="w-full"
            onClick={() => toggleMirror(id)}
          >
            {clip.transform.mirrored ? '⇋ 鏡像中(左右相反)' : '⇋ 左右鏡像'}
          </Button>
          <p className="text-[11px] leading-relaxed text-white/35">
            參考影片是鏡像版、或自己對著鏡子拍時打開,兩邊動作才對得上。
          </p>

          <div className="rounded-md bg-black/30 p-2 ring-1 ring-white/10">
            <Button
              variant={adjusting ? 'primary' : 'default'}
              className="w-full"
              onClick={() => setAdjustTarget(adjusting ? null : id)}
            >
              {adjusting ? '完成調整' : '用手勢調整畫面'}
            </Button>
            <p className="mt-1.5 text-[11px] leading-relaxed text-white/40">
              {adjusting
                ? '直接在畫面上拖曳移動、兩指捏合縮放。調整期間頁面不會跟著捲動。'
                : '開啟後可在畫面上直接拖曳與捏合,比拉 slider 快得多。'}
            </p>
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-white/50">
              <span>
                縮放 {(clip.transform.scale * 100).toFixed(0)}% · 位移{' '}
                {clip.transform.offsetX.toFixed(0)}, {clip.transform.offsetY.toFixed(0)}
              </span>
              <Button variant="ghost" onClick={() => resetTransform(id)}>
                重設
              </Button>
            </div>
          </div>

          <Slider
            label="旋轉"
            value={clip.transform.rotation}
            min={-180}
            max={180}
            step={0.5}
            onChange={(v) => setTransform(id, { rotation: v })}
            format={(v) => `${v.toFixed(1)}°`}
          />
          <Slider
            label="音量"
            value={clip.volume}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => setVolume(id, v)}
            format={(v) => `${(v * 100).toFixed(0)}%`}
          />

          <div className="flex items-end gap-2">
            <Field label="逐幀步進用的 fps">
              <select
                className={inputClass}
                value={clip.fps}
                onChange={(e) => setFps(id, Number(e.target.value))}
              >
                {FPS_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </Field>
            <Button onClick={() => fileRef.current?.click()}>換片</Button>
          </div>
        </>
      )}

      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </Panel>
  )
}
