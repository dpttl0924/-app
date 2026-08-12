import { COUNT_IN_BEAT_OPTIONS, countInPlan, useProject } from '../store/useProject'
import { MAX_BPM, MIN_BPM } from '../lib/tempo'
import { formatSeconds } from '../lib/format'
import { Button, Field, Panel, Slider, inputClass } from './ui'

const STATUS_STYLE = {
  idle: 'text-white/35',
  running: 'text-indigo-300',
  ok: 'text-emerald-300',
  weak: 'text-amber-300',
  error: 'text-red-400',
} as const

/**
 * 開頭的節拍器預備拍。
 *
 * 速度可以自動測(重用音訊對齊算好的起音包絡),但一定要能手動改 ——
 * 測速在節奏不明確的音訊上會失準,而使用者往往自己知道正確答案。
 */
export function CountInPanel() {
  const clips = useProject((s) => s.clips)
  const countIn = useProject((s) => s.countIn)
  const tempo = useProject((s) => s.tempo)
  const tempoStatus = useProject((s) => s.tempoStatus)
  const tempoMessage = useProject((s) => s.tempoMessage)
  const setCountIn = useProject((s) => s.setCountIn)
  const detectTempoFromAudio = useProject((s) => s.detectTempoFromAudio)

  const ready = Boolean(clips.a?.onset || clips.b?.onset)
  const plan = countInPlan(countIn, tempo?.phaseMs ?? 0)

  return (
    <Panel
      title="預備拍"
      right={
        <Button
          active={countIn.enabled}
          onClick={() => setCountIn({ enabled: !countIn.enabled })}
        >
          {countIn.enabled ? '已開啟' : '關閉中'}
        </Button>
      }
    >
      <Button
        variant="primary"
        className="w-full"
        disabled={!ready || tempoStatus === 'running'}
        onClick={detectTempoFromAudio}
      >
        {tempoStatus === 'running' ? '測量中…' : '自動偵測歌曲速度'}
      </Button>
      <p className={`text-[11px] leading-relaxed ${STATUS_STYLE[tempoStatus]}`}>
        {tempoMessage || (ready ? '從音訊測出 BPM,並對齊拍點' : '載入影片後可用')}
      </p>

      <div className="grid grid-cols-2 gap-2 border-t border-white/10 pt-2">
        <Field label={`速度 ${MIN_BPM}–${MAX_BPM} BPM`}>
          <input
            type="number"
            className={inputClass}
            min={MIN_BPM}
            max={MAX_BPM}
            step={0.5}
            value={countIn.bpm}
            onChange={(e) => setCountIn({ bpm: Number(e.target.value) })}
          />
        </Field>
        <Field label="拍數">
          <select
            className={inputClass}
            value={countIn.beats}
            onChange={(e) => setCountIn({ beats: Number(e.target.value) })}
          >
            {COUNT_IN_BEAT_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b} 拍
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Slider
        label="節拍器音量"
        value={countIn.volume}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => setCountIn({ volume: v })}
        format={(v) => `${(v * 100).toFixed(0)}%`}
      />

      <p className="text-[11px] leading-relaxed text-white/35">
        {countIn.enabled
          ? `開頭會多出 ${formatSeconds(plan.durationMs)} 的節拍器,共 ${plan.clickTimesMs.length} 聲。`
          : '開啟後會在影片前面加一段節拍器。'}
        {tempo
          ? ' 最後一聲會落在歌曲第一個重拍的前一拍,接進去是連續的。'
          : ' 先偵測速度的話,節拍器會跟歌曲的拍點對齊;沒偵測就只是單純在前面加幾拍。'}
      </p>
    </Panel>
  )
}
