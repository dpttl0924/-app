import { useProject } from '../store/useProject'
import { formatTime } from '../lib/format'
import { Button, Field, Panel, Slider, inputClass } from './ui'

export function AnnotationPanel() {
  const annotations = useProject((s) => s.annotations)
  const selectedId = useProject((s) => s.selectedAnnotation)
  const durationMs = useProject((s) => s.durationMs)
  const addAnnotation = useProject((s) => s.addAnnotation)
  const updateAnnotation = useProject((s) => s.updateAnnotation)
  const removeAnnotation = useProject((s) => s.removeAnnotation)
  const selectAnnotation = useProject((s) => s.selectAnnotation)
  const seek = useProject((s) => s.seek)
  const setPlaying = useProject((s) => s.setPlaying)

  const selected = annotations.find((a) => a.id === selectedId) ?? null

  return (
    <Panel
      title="文字標註"
      right={
        <Button onClick={addAnnotation} disabled={durationMs <= 0}>
          + 在播放頭新增
        </Button>
      }
    >
      {annotations.length === 0 ? (
        <p className="text-[11px] text-white/35">
          在想標記的時間點按「新增」,文字可直接拖到畫面上任意位置。
        </p>
      ) : (
        <ul className="max-h-32 space-y-1 overflow-y-auto">
          {annotations.map((a) => (
            <li key={a.id}>
              <button
                onClick={() => {
                  selectAnnotation(a.id)
                  setPlaying(false)
                  seek(a.timeMs)
                }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] hover:bg-white/10 ${
                  selectedId === a.id ? 'bg-indigo-500/25' : ''
                }`}
              >
                <span className="font-mono tabular-nums text-white/50">
                  {formatTime(a.timeMs)}
                </span>
                <span className="truncate text-white/85">{a.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="space-y-2 border-t border-white/10 pt-2">
          <Field label="文字(可換行)">
            <textarea
              className={`${inputClass} resize-y`}
              rows={2}
              value={selected.text}
              onChange={(e) => updateAnnotation(selected.id, { text: e.target.value })}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="出現時間">
              <input
                type="number"
                step={0.1}
                className={inputClass}
                value={(selected.timeMs / 1000).toFixed(2)}
                onChange={(e) =>
                  updateAnnotation(selected.id, { timeMs: Number(e.target.value) * 1000 })
                }
              />
            </Field>
            <Field label="持續秒數">
              <input
                type="number"
                step={0.1}
                min={0.1}
                className={inputClass}
                value={(selected.durationMs / 1000).toFixed(2)}
                onChange={(e) =>
                  updateAnnotation(selected.id, {
                    durationMs: Math.max(100, Number(e.target.value) * 1000),
                  })
                }
              />
            </Field>
          </div>

          <Slider
            label="字級"
            value={selected.fontSize}
            min={16}
            max={160}
            step={1}
            onChange={(v) => updateAnnotation(selected.id, { fontSize: v })}
            format={(v) => `${v.toFixed(0)}px`}
          />

          <div className="flex items-center gap-2">
            <input
              type="color"
              className="h-7 w-10 cursor-pointer rounded bg-transparent"
              value={selected.color}
              onChange={(e) => updateAnnotation(selected.id, { color: e.target.value })}
            />
            <Button
              variant="ghost"
              className="ml-auto text-red-300"
              onClick={() => removeAnnotation(selected.id)}
            >
              刪除
            </Button>
          </div>
        </div>
      )}
    </Panel>
  )
}
