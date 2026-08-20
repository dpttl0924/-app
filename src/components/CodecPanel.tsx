import { useEffect, useState } from 'react'
import { useProject } from '../store/useProject'
import type { Capabilities } from '../lib/webcodecs/capabilities'
import { Panel } from './ui'

/**
 * 這台裝置能產出什麼格式。
 *
 * 這個面板是為了回答一個沒辦法用猜的問題:**你的手機和電腦到底編得出什麼**。
 * H.264/MP4 是唯一 iPhone、Android、桌機全都播得了的組合;
 * 只編得出 VP9/WebM 的話,產出的檔案在 iPhone 上打不開,匯出等於白做。
 */
export function CodecPanel() {
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [failed, setFailed] = useState(false)
  // 還沒有素材就沒有東西可以匯出,這個面板也還沒有話要說
  const hasClips = useProject((s) => Boolean(s.clips.a || s.clips.b))

  /*
    偵測本身要載入 mediabunny(整包的八成)。原本掛在 mount 上,等於每個
    開啟網頁的人都先付這筆下載 —— 但這裡的資訊要等到有素材才有意義。

    綁在「載入了素材」而不是「按下匯出」:這個面板的價值是**事先**警告
    「你的裝置只編得出 WebM,iPhone 打不開」。等按下匯出才講就太晚了,
    對齊和裁切的功夫已經花完了。
  */
  useEffect(() => {
    if (!hasClips) return
    let alive = true
    void import('../lib/webcodecs/capabilities')
      .then((m) => m.detectCapabilities())
      .then((c) => {
        if (alive) setCaps(c)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [hasClips])

  if (!hasClips) {
    return (
      <Panel title="編碼能力">
        <p className="text-[11px] leading-relaxed text-white/35">
          載入影片後偵測這台裝置編得出什麼格式。
        </p>
      </Panel>
    )
  }

  if (failed) {
    return (
      <Panel title="編碼能力">
        <p className="text-[11px] leading-relaxed text-amber-300">
          載不到編碼模組,匯出會走即時錄製。檢查網路後重新整理可以再試一次。
        </p>
      </Panel>
    )
  }

  if (!caps) {
    return (
      <Panel title="編碼能力">
        <p className="text-[11px] text-white/35">偵測中…</p>
      </Panel>
    )
  }

  if (!caps.hasWebCodecs) {
    return (
      <Panel title="編碼能力">
        <p className="text-[11px] leading-relaxed text-amber-300">
          這個瀏覽器不支援 WebCodecs,匯出會走舊的即時錄製(時間等於影片長度)。
        </p>
      </Panel>
    )
  }

  return (
    <Panel title="編碼能力">
      <div className="flex flex-wrap gap-1">
        {caps.video.map((v) => (
          <CodecChip key={v.codec} label={v.codec.toUpperCase()} ok={v.supported} />
        ))}
        {caps.audio.map((a) => (
          <CodecChip key={a.codec} label={a.codec.toUpperCase()} ok={a.supported} />
        ))}
      </div>

      {caps.choice ? (
        <>
          <p className="text-[11px] leading-relaxed text-white/60">
            會輸出{' '}
            <span className="font-mono text-emerald-300">
              {caps.choice.container.toUpperCase()} / {caps.choice.video.toUpperCase()}
              {' + '}
              {caps.choice.audio?.toUpperCase() ?? '無聲'}
            </span>
          </p>
          <p
            className={`text-[11px] leading-relaxed ${
              caps.playableOnIphone ? 'text-white/35' : 'text-amber-300'
            }`}
          >
            {caps.playableOnIphone
              ? 'H.264 / MP4 —— iPhone、Android、桌機都播得了。'
              : '這台裝置編不出 H.264,只能輸出 WebM ——「iPhone 上打不開」。要分享給 iPhone 使用者的話,改用支援 H.264 的瀏覽器再匯出。'}
          </p>
        </>
      ) : (
        <p className="text-[11px] leading-relaxed text-amber-300">
          找不到可用的視訊編碼器,匯出會走舊的即時錄製。
        </p>
      )}
    </Panel>
  )
}

function CodecChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
        ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-white/30 line-through'
      }`}
    >
      {label}
    </span>
  )
}
