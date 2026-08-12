import { useRef, useState } from 'react'
import { useProject } from '../store/useProject'
import { formatSeconds, formatTime } from '../lib/format'
import { MAX_CLIP_SCALE, MIN_CLIP_SCALE, isAudioOnly, type ClipId } from '../lib/types'
import { Button, Field, Panel, Slider, inputClass } from './ui'

const FPS_OPTIONS = [24, 25, 30, 50, 60]
/** 每按一次縮放的倍率。10% 夠細,又不會按到手痠。 */
const ZOOM_STEP = 1.1

export function ClipPanel({ id }: { id: ClipId }) {
  const clip = useProject((s) => s.clips[id])
  const loading = useProject((s) => s.loading)
  const adjusting = useProject((s) => s.adjustTarget === id)
  const setAdjustTarget = useProject((s) => s.setAdjustTarget)
  const loadClip = useProject((s) => s.loadClip)
  const removeClip = useProject((s) => s.removeClip)
  const resetTransform = useProject((s) => s.resetTransform)
  const toggleMirror = useProject((s) => s.toggleMirror)
  const zoomClip = useProject((s) => s.zoomClip)
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
  const inputId = `clip-file-${id}`
  const busy = loading?.id === id

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
      {/*
        sr-only 而不是 hidden:iOS Safari 對 display:none 的 file input 行為不可靠,
        而且這裡改用 <label htmlFor> 觸發,不靠 JS 的 .click() —— 那在 iPhone 上
        是已知會出問題的組合(選完照片回不到網頁、按打勾沒反應)。
      */}
      {/* 也接受純音檔:只有參考音樂、沒有舞蹈影片時,還是可以放進來對齊、剪輯、匯出 */}
      <input
        id={inputId}
        ref={fileRef}
        type="file"
        accept="video/*,audio/*"
        className="sr-only"
        onChange={(e) => void pick(e.target.files?.[0])}
      />

      {!clip ? (
        <label
          htmlFor={inputId}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            void pick(e.dataTransfer.files?.[0])
          }}
          className="block cursor-pointer rounded-md border border-dashed border-white/20 px-3 py-7 text-center text-xs text-white/40 hover:border-indigo-400 hover:text-white/70"
        >
          {busy ? (
            <span className="text-indigo-300">{loading!.stage}</span>
          ) : (
            `點擊選擇影片或音檔 ${label}(或拖放到這裡)`
          )}
        </label>
      ) : (
        <>
          <div className="text-[11px] leading-relaxed">
            <div className={`truncate font-medium ${accent}`} title={clip.name}>
              {clip.name}
            </div>
            <div className="text-white/40">
              {isAudioOnly(clip) ? '純音訊' : `${clip.width}×${clip.height}`} ·{' '}
              {formatTime(clip.durationMs)}
              {clip.envelope ? ' · 音訊已分析' : ' · 音訊分析中…'}
            </div>
          </div>

          <Field label={`時間偏移 ${formatSeconds(clip.offsetMs)}`}>
            <div className="flex flex-wrap gap-1">
              {/* 粗調在時間軸上拖,這裡只留拖不出來的精度 */}
              <Button onClick={() => nudgeOffset(id, -1000 / clip.fps)}>◀ 一格</Button>
              <Button onClick={() => nudgeOffset(id, 1000 / clip.fps)}>一格 ▶</Button>
              <Button variant="ghost" onClick={() => setOffset(id, 0)}>
                歸零
              </Button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-white/35">
              粗調直接在時間軸上拖這支影片的色條,這裡是逐格微調(
              {clip.fps}fps,一格 {(1000 / clip.fps).toFixed(0)}ms)。
            </p>
          </Field>

          <Button
            variant={clip.transform.mirrored ? 'primary' : 'default'}
            className="w-full"
            onClick={() => toggleMirror(id)}
          >
            {clip.transform.mirrored ? '⇋ 鏡像中(左右相反)' : '⇋ 左右鏡像'}
          </Button>
          <p className="text-[11px] leading-relaxed text-white/35">
            {isAudioOnly(clip)
              ? '純音訊沒有畫面,這顆按鈕不會有視覺變化。'
              : '參考影片是鏡像版、或自己對著鏡子拍時打開,兩邊動作才對得上。'}
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
              {isAudioOnly(clip)
                ? '純音訊沒有畫面可以縮放或移動,佔位框會固定填滿整格。'
                : adjusting
                ? '在畫面上拖曳移動、兩指捏合或滾輪縮放。調整期間頁面不會跟著捲動。'
                : '開啟後可在畫面上直接拖曳與縮放,比拉 slider 快得多。'}
            </p>

            {/* 滾輪不是每個裝置都有,而且看不到目前倍率會很難回到原點 */}
            <div className="mt-1.5 flex items-center gap-1">
              <Button
                className="flex-1"
                disabled={clip.transform.scale <= MIN_CLIP_SCALE + 1e-6}
                onClick={() => zoomClip(id, 1 / ZOOM_STEP)}
              >
                − 縮小
              </Button>
              <span className="w-14 text-center text-[11px] tabular-nums text-white/70">
                {(clip.transform.scale * 100).toFixed(0)}%
              </span>
              <Button
                className="flex-1"
                disabled={clip.transform.scale >= MAX_CLIP_SCALE - 1e-6}
                onClick={() => zoomClip(id, ZOOM_STEP)}
              >
                放大 +
              </Button>
            </div>

            <div className="mt-1.5 flex items-center justify-between text-[11px] text-white/40">
              <span>
                位移 {clip.transform.offsetX.toFixed(0)}, {clip.transform.offsetY.toFixed(0)}
              </span>
              <Button variant="ghost" onClick={() => resetTransform(id)}>
                重設
              </Button>
            </div>
          </div>

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
            {/* 同樣用 label 而不是 JS 觸發 */}
            <label
              htmlFor={inputId}
              className="inline-flex min-h-9 cursor-pointer touch-manipulation items-center justify-center rounded-md bg-white/10 px-3 text-xs font-medium text-white/90 transition select-none hover:bg-white/20"
            >
              {busy ? loading!.stage : '換片'}
            </label>
          </div>
        </>
      )}

      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </Panel>
  )
}
