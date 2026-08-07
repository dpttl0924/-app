import { useProject } from '../store/useProject'
import { averageCoverage, bestAspect } from '../lib/layout'
import {
  ASPECT_LABELS,
  ASPECT_SIZES,
  type AspectRatio,
  type CompareMode,
} from '../lib/types'
import { Button, Panel, Slider } from './ui'

const MODES: { id: CompareMode; label: string; hint: string }[] = [
  { id: 'sideBySide', label: '左右', hint: '看整體站位與身形' },
  { id: 'stacked', label: '上下', hint: '直式影片放直式輸出時最合適' },
  { id: 'overlay', label: '疊加', hint: '看細部角度差' },
  { id: 'wipe', label: '分割線', hint: '拖線比對同一個部位' },
]

const ASPECTS: AspectRatio[] = ['9:16', '1:1', '16:9']

export function ModePanel() {
  const aspect = useProject((s) => s.aspect)
  const setAspect = useProject((s) => s.setAspect)
  const mode = useProject((s) => s.mode)
  const setMode = useProject((s) => s.setMode)
  const opacity = useProject((s) => s.opacity)
  const setOpacity = useProject((s) => s.setOpacity)
  const blend = useProject((s) => s.blend)
  const setBlend = useProject((s) => s.setBlend)
  const wipe = useProject((s) => s.wipe)
  const setWipe = useProject((s) => s.setWipe)

  const clips = useProject((s) => s.clips)
  const current = MODES.find((m) => m.id === mode)

  // 黑邊佔比太高時直接建議更合適的比例,而不是讓使用者自己試
  const coverage = averageCoverage([clips.a, clips.b], mode, ASPECT_SIZES[aspect])
  const suggestion = bestAspect([clips.a, clips.b], mode)
  const suggestedCoverage = averageCoverage(
    [clips.a, clips.b],
    mode,
    ASPECT_SIZES[suggestion],
  )
  const showSuggestion =
    coverage < 0.75 && suggestion !== aspect && suggestedCoverage > coverage + 0.1

  return (
    <Panel title="輸出比例與對比模式">
      <div className="grid grid-cols-3 gap-1">
        {ASPECTS.map((a) => (
          <Button key={a} active={aspect === a} onClick={() => setAspect(a)}>
            {ASPECT_LABELS[a]}
          </Button>
        ))}
      </div>
      {showSuggestion ? (
        <div className="rounded-md bg-amber-400/10 p-2 ring-1 ring-amber-400/30">
          <p className="text-[11px] leading-relaxed text-amber-200/90">
            目前只有 {(coverage * 100).toFixed(0)}% 的畫面是影片,其餘都是黑邊。
            換成 {ASPECT_LABELS[suggestion]} 可以提高到{' '}
            {(suggestedCoverage * 100).toFixed(0)}%。
          </p>
          <Button className="mt-1.5 w-full" onClick={() => setAspect(suggestion)}>
            改用 {ASPECT_LABELS[suggestion]}
          </Button>
        </div>
      ) : (
        <p className="text-[11px] text-white/35">
          手機拍的影片幾乎都是直式,分享到 IG / TikTok 也用 9:16。
        </p>
      )}

      <div className="grid grid-cols-4 gap-1 border-t border-white/10 pt-2">
        {MODES.map((m) => (
          <Button key={m.id} active={mode === m.id} onClick={() => setMode(m.id)}>
            {m.label}
          </Button>
        ))}
      </div>
      <p className="text-[11px] text-white/35">{current?.hint}</p>

      {mode === 'overlay' && (
        <>
          <Slider
            label="B 的不透明度"
            value={opacity}
            min={0}
            max={1}
            step={0.01}
            onChange={setOpacity}
            format={(v) => `${(v * 100).toFixed(0)}%`}
          />
          <div className="flex items-center gap-1">
            <Button active={blend === 'normal'} onClick={() => setBlend('normal')}>
              一般疊加
            </Button>
            <Button
              active={blend === 'difference'}
              onClick={() => setBlend('difference')}
            >
              差異模式
            </Button>
          </div>
          <p className="text-[11px] text-white/35">
            差異模式下,兩邊動作一致的地方會變黑,對不上的地方會發亮 ——
            比半透明疊加更容易一眼看出偏差。
          </p>
        </>
      )}

      {mode === 'wipe' && (
        <Slider
          label="分割線位置"
          value={wipe}
          min={0}
          max={1}
          step={0.005}
          onChange={setWipe}
          format={(v) => `${(v * 100).toFixed(0)}%`}
        />
      )}
    </Panel>
  )
}
