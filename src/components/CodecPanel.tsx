import { useEffect, useState } from 'react'
import { detectCapabilities, type Capabilities } from '../lib/webcodecs/capabilities'
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

  useEffect(() => {
    let alive = true
    void detectCapabilities().then((c) => {
      if (alive) setCaps(c)
    })
    return () => {
      alive = false
    }
  }, [])

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
              {caps.choice.audio.toUpperCase()}
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
