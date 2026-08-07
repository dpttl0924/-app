import { useProject } from '../store/useProject'
import { Button, Panel } from './ui'

const STATUS_STYLE = {
  idle: 'text-white/35',
  running: 'text-indigo-300',
  done: 'text-emerald-300',
  warn: 'text-amber-300',
  error: 'text-red-400',
} as const

export function AlignPanel() {
  const clips = useProject((s) => s.clips)
  const align = useProject((s) => s.align)
  const autoAlign = useProject((s) => s.autoAlign)
  const applyLag = useProject((s) => s.applyLag)

  const ready = Boolean(clips.a?.onset && clips.b?.onset)
  const bothLoaded = Boolean(clips.a && clips.b)

  return (
    <Panel title="音訊自動對齊">
      <Button
        variant="primary"
        className="w-full py-2"
        disabled={!ready || align.status === 'running'}
        onClick={autoAlign}
      >
        {align.status === 'running' ? '比對中…' : '自動對齊兩段影片'}
      </Button>

      <p className={`text-[11px] ${STATUS_STYLE[align.status]}`}>
        {align.message ||
          (!bothLoaded
            ? '載入兩段影片後可用'
            : !ready
              ? '音訊分析中,稍候即可使用'
              : '兩段影片跳同一首歌時,可自動算出時間偏移')}
      </p>

      {align.alternativeLagMs !== null && (
        <div className="rounded-md bg-amber-400/10 p-2 ring-1 ring-amber-400/30">
          <p className="text-[11px] leading-relaxed text-amber-200/90">
            另一個候選位置分數接近。舞曲節奏重複時容易對到別的小節,
            兩個都試一次、看哪個的波形對得上。
          </p>
          <Button
            className="mt-1.5 w-full"
            onClick={() => applyLag(align.alternativeLagMs!)}
          >
            改用 {(align.alternativeLagMs / 1000).toFixed(2)}s
          </Button>
        </div>
      )}

      <details className="text-[11px] text-white/35">
        <summary className="cursor-pointer text-white/50">怎麼做到的</summary>
        <p className="mt-1.5 leading-relaxed">
          兩段影片配的是同一首歌,音訊內容幾乎相同、只差一個時間偏移。 把音訊轉成
          100Hz 的「起音強度」序列(音量的正向變化,也就是鼓點和重拍),
          再對兩串序列做互相關 —— 相關性最高的位移量就是答案。
          直接算是 O(n²),改用 FFT 之後是 O(n log n),3 分鐘的歌可以在幾十毫秒內算完。
        </p>
        <p className="mt-1.5 leading-relaxed">
          偏移量本身在「真的是同一首歌」時一律算得準。 但要判斷「有沒有對到正確的小節」
          就沒有便宜的指標可用 —— 試過 z-score 和相關係數都沒有鑑別力(兩首無關但同 BPM
          的歌照樣拿 0.93)。所以這裡不給判決分數, 只把分數接近的第二個位置也交出來讓你切換,
          最終以時間軸上兩條波形是否對齊為準。
        </p>
      </details>
    </Panel>
  )
}
