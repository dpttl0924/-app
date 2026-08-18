import { formatSeconds, formatTime } from '../lib/format'
import { useTrim } from '../hooks/useTrim'
import { Button, Panel } from './ui'

/**
 * 剪輯:在播放頭切一刀,然後刪掉不要的那半。
 *
 * 上一版是「起點設為現在 / 訖點設為現在」,實際用起來很卡 ——
 * 那是編輯器的說法,使用者得先在腦中把要保留的範圍想清楚,才知道該按哪一個。
 * 「切一刀,刪掉不要的那邊」不用想,看著畫面做就好。
 *
 * 這是手機版的樣子。桌機把同一組操作攤平放在播放列上(TrimBar),
 * 規則兩邊共用 useTrim(),差別只有版面。
 */
export function TrimPanel() {
  const trim = useTrim()

  return (
    <Panel
      title="剪輯"
      right={
        trim.canUndo ? (
          <Button variant="ghost" onClick={trim.undoTrim}>
            ↩ 復原
          </Button>
        ) : null
      }
    >
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-white/50">保留</span>
        <span className="font-mono tabular-nums text-emerald-300">
          {formatTime(trim.range.startMs)} – {formatTime(trim.range.endMs)}
        </span>
        <span className="text-white/40">
          共 {formatSeconds(trim.range.durationMs)}
          {trim.trimmed && (
            <span className="text-white/25"> / {formatSeconds(trim.contentMs)}</span>
          )}
        </span>
      </div>

      {trim.splitAtMs === null ? (
        <>
          <Button
            variant="primary"
            className="w-full py-2"
            disabled={trim.empty}
            onClick={trim.split}
          >
            ✂ 在播放頭切開
          </Button>
          <p className="text-[11px] leading-relaxed text-white/35">
            把播放頭移到要切的位置再按,接著選一邊刪掉。
            刪掉的部分只是不輸出,原始影片不會被改,隨時可以復原。
          </p>
        </>
      ) : (
        <div className="space-y-2 rounded-md bg-amber-400/10 p-2 ring-1 ring-amber-400/30">
          <p className="text-[11px] text-amber-200/90">
            在 <span className="font-mono">{formatTime(trim.splitAtMs)}</span>{' '}
            切開了。要刪掉哪一段?
          </p>
          {/* 按鈕的左右位置要對應時間軸上的左右,不然每次都要停下來想一下 */}
          <div className="grid grid-cols-2 gap-1">
            <Button
              disabled={!trim.canDeleteLeft}
              onClick={() => trim.deleteSegment('left')}
              title="保留右段"
            >
              ← 刪掉左邊
              <span className="ml-1 text-[10px] opacity-60">
                {formatSeconds(trim.splitAtMs - trim.range.startMs)}
              </span>
            </Button>
            <Button
              disabled={!trim.canDeleteRight}
              onClick={() => trim.deleteSegment('right')}
              title="保留左段"
            >
              刪掉右邊 →
              <span className="ml-1 text-[10px] opacity-60">
                {formatSeconds(trim.range.endMs - trim.splitAtMs)}
              </span>
            </Button>
          </div>
          <Button variant="ghost" className="w-full" onClick={trim.cancelSplit}>
            取消
          </Button>
        </div>
      )}

      {trim.trimmed && (
        <Button variant="ghost" className="w-full" onClick={trim.clearRange}>
          還原成完整長度
        </Button>
      )}
    </Panel>
  )
}
