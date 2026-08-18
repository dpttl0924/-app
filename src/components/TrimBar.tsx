import { formatSeconds, formatTime } from '../lib/format'
import { useTrim } from '../hooks/useTrim'
import { Button } from './ui'

/**
 * 播放列上的剪輯 —— 桌機版。
 *
 * 放在時間軸正上方而不是右側面板裡:切點是盯著時間軸與畫面決定的,
 * 「切開 → 刪掉哪一邊」則是緊接在那個動作後面的第二步。
 * 隔著半個畫面來回看,每切一刀都要重新找一次按鈕在哪、再把視線移回來。
 *
 * 手機沒有這個橫向空間,那邊維持分頁裡的 TrimPanel,兩者共用 useTrim()。
 */
export function TrimBar() {
  const trim = useTrim()

  // 切開之後就換成「刪哪一邊」,不留著切開的按鈕 ——
  // 這是一個有先後的兩步動作,同時給兩組按鈕只會讓人猶豫該按哪個
  if (trim.splitAtMs !== null) {
    return (
      <div className="flex items-center gap-1.5 rounded-md bg-amber-400/10 px-2 py-1 ring-1 ring-amber-400/30">
        <span className="text-[11px] whitespace-nowrap text-amber-200/90">
          在 <span className="font-mono">{formatTime(trim.splitAtMs)}</span> 切開,刪掉
        </span>
        {/* 左右要對應時間軸上的左右,不然每次都要停下來想一下 */}
        <Button
          disabled={!trim.canDeleteLeft}
          onClick={() => trim.deleteSegment('left')}
          title="保留右段"
        >
          ← 左邊
          <span className="ml-1 text-[10px] opacity-60">
            {formatSeconds(trim.splitAtMs - trim.range.startMs)}
          </span>
        </Button>
        <Button
          disabled={!trim.canDeleteRight}
          onClick={() => trim.deleteSegment('right')}
          title="保留左段"
        >
          右邊 →
          <span className="ml-1 text-[10px] opacity-60">
            {formatSeconds(trim.range.endMs - trim.splitAtMs)}
          </span>
        </Button>
        <Button variant="ghost" onClick={trim.cancelSplit}>
          取消
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        disabled={trim.empty}
        onClick={trim.split}
        title="在播放頭切一刀,再選一邊刪掉"
      >
        ✂ 切開
      </Button>

      {/* 沒剪過就不佔位置 —— 這一行還要放時間讀數與速度 */}
      {trim.trimmed && (
        <>
          <span className="font-mono text-[11px] whitespace-nowrap tabular-nums text-emerald-300">
            {formatTime(trim.range.startMs)} – {formatTime(trim.range.endMs)}
          </span>
          <span className="text-[11px] whitespace-nowrap text-white/35">
            {formatSeconds(trim.range.durationMs)} / {formatSeconds(trim.contentMs)}
          </span>
          <Button variant="ghost" onClick={trim.clearRange} title="還原成完整長度">
            還原
          </Button>
        </>
      )}

      {trim.canUndo && (
        <Button variant="ghost" onClick={trim.undoTrim}>
          ↩ 復原
        </Button>
      )}
    </div>
  )
}
