import { create } from 'zustand'
import { alignOnsets, analyzeAudio } from '../lib/audio'
import { projectDuration } from '../lib/layout'
import { playbackClock } from '../lib/playbackClock'
import {
  ASPECT_SIZES,
  DEFAULT_TRANSFORM,
  type Annotation,
  type AspectRatio,
  type BlendMode,
  type Clip,
  type ClipId,
  type ClipTransform,
  type CompareMode,
} from '../lib/types'

export type AlignStatus = 'idle' | 'running' | 'done' | 'warn' | 'error'

interface AlignState {
  status: AlignStatus
  message: string
  /** 分數接近的另一個候選偏移量(ms),沒有就是 null */
  alternativeLagMs: number | null
}

const IDLE_ALIGN: AlignState = { status: 'idle', message: '', alternativeLagMs: null }

/** score 低於這個值,兩段音訊大概不是同一首歌 */
const MIN_SCORE = 0.4

interface ProjectState {
  clips: Record<ClipId, Clip | null>
  aspect: AspectRatio
  mode: CompareMode
  /** overlay 模式下上層(B)的不透明度 */
  opacity: number
  blend: BlendMode
  /** wipe 模式的分割線位置 0..1 */
  wipe: number
  annotations: Annotation[]
  selectedAnnotation: string | null
  /** 目前用手勢直接調整的是哪一段影片。null = 手勢關閉,讓頁面正常捲動。 */
  adjustTarget: ClipId | null

  currentMs: number
  durationMs: number
  /**
   * 要播放與匯出的區間,設在專案時間軸上、兩支影片一起套用。
   *
   * 早期版本是每支影片各自設 in/out,結果很難用:裁掉 A 的頭之後,
   * 為了不破壞對齊必須把 A 往後推同樣的時間,於是前面多出一段 A 只有靜止畫格的死區,
   * 而且專案根本沒變短 —— 裁了等於沒裁。
   *
   * 改成專案層級之後,對齊自動不受影響(兩邊的相對位置沒動過),
   * 沒有死區,專案也真的變短。
   */
  rangeInMs: number
  /** null = 一直到專案結尾。這樣之後載入更長的影片時範圍會自動延伸。 */
  rangeOutMs: number | null
  /**
   * 待處理的切點:按下「切開」之後、還沒選邊刪掉的中間狀態。
   *
   * 「設起點/設訖點」對使用者來說是編輯器思維 —— 要先在腦中把範圍想清楚才知道要按哪個。
   * 「切一刀,然後刪掉不要的那半」不用想,看著畫面做就好。
   * 兩者的底層資料完全一樣:在 T 切開刪左邊 = rangeIn 設為 T,刪右邊 = rangeOut 設為 T。
   */
  splitAtMs: number | null
  /** 上一次剪輯前的範圍。刪東西一定要能反悔。 */
  previousRange: { inMs: number; outMs: number | null } | null
  playing: boolean
  rate: number

  align: AlignState
  loading: ClipId | null

  loadClip: (id: ClipId, file: File) => Promise<void>
  removeClip: (id: ClipId) => void
  setAspect: (aspect: AspectRatio) => void
  setMode: (mode: CompareMode) => void
  setAdjustTarget: (id: ClipId | null) => void
  setOpacity: (v: number) => void
  setBlend: (v: BlendMode) => void
  setWipe: (v: number) => void
  setTransform: (id: ClipId, patch: Partial<ClipTransform>) => void
  resetTransform: (id: ClipId) => void
  toggleMirror: (id: ClipId) => void
  setOffset: (id: ClipId, ms: number) => void
  nudgeOffset: (id: ClipId, deltaMs: number) => void
  splitAtPlayhead: () => void
  cancelSplit: () => void
  deleteSegment: (side: 'left' | 'right') => void
  undoTrim: () => void
  clearRange: () => void
  setVolume: (id: ClipId, v: number) => void
  setFps: (id: ClipId, fps: number) => void

  seek: (ms: number) => void
  setPlaying: (v: boolean) => void
  togglePlay: () => void
  setRate: (v: number) => void
  stepFrame: (dir: 1 | -1) => void

  addAnnotation: () => void
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void
  removeAnnotation: (id: string) => void
  selectAnnotation: (id: string | null) => void

  autoAlign: () => void
  /** 依照「offsetB - offsetA = lagMs」設定兩段影片的偏移 */
  applyLag: (lagMs: number) => void
}

function probeVideo(url: string) {
  return new Promise<{ durationMs: number; width: number; height: number }>(
    (resolve, reject) => {
      const el = document.createElement('video')
      el.preload = 'metadata'
      el.muted = true
      el.onloadedmetadata = () => {
        resolve({
          durationMs: el.duration * 1000,
          width: el.videoWidth,
          height: el.videoHeight,
        })
        el.removeAttribute('src')
        el.load()
      }
      el.onerror = () => reject(new Error('無法讀取影片,格式可能不支援'))
      el.src = url
    },
  )
}

/** 輸出範圍至少要留這麼長,否則會匯出一個空檔案 */
const MIN_RANGE_MS = 200

/** 每次動到 clip 就要重算專案長度,並把播放頭夾回範圍內 */
function withDuration(clips: Record<ClipId, Clip | null>, currentMs: number) {
  const durationMs = projectDuration([clips.a, clips.b])
  const clamped = Math.min(currentMs, durationMs)
  // 時鐘是播放引擎的真實來源,只更新 store 的話引擎下一幀又會把它寫回舊值
  playbackClock.currentMs = clamped
  // 時間軸長度變了,待處理的切點就失去意義了
  return { durationMs, currentMs: clamped, splitAtMs: null }
}

export interface PlayRange {
  startMs: number
  endMs: number
  /** 範圍長度,也就是匯出的影片長度 */
  durationMs: number
}

/** 實際要播放與匯出的區間。rangeOutMs 為 null 時代表一直到專案結尾。 */
export function playRange(s: {
  rangeInMs: number
  rangeOutMs: number | null
  durationMs: number
}): PlayRange {
  const startMs = Math.min(s.rangeInMs, s.durationMs)
  const endMs = s.rangeOutMs ?? s.durationMs
  return { startMs, endMs, durationMs: Math.max(0, endMs - startMs) }
}

export const useProject = create<ProjectState>()((set, get) => ({
  clips: { a: null, b: null },
  // 手機拍的舞蹈影片幾乎都是直式,預設就給直式輸出
  aspect: '9:16',
  mode: 'sideBySide',
  opacity: 0.5,
  blend: 'normal',
  wipe: 0.5,
  annotations: [],
  selectedAnnotation: null,
  adjustTarget: null,

  currentMs: 0,
  durationMs: 0,
  rangeInMs: 0,
  rangeOutMs: null,
  splitAtMs: null,
  previousRange: null,
  playing: false,
  rate: 1,

  align: IDLE_ALIGN,
  loading: null,

  async loadClip(id, file) {
    const prev = get().clips[id]
    if (prev) URL.revokeObjectURL(prev.url)

    set({ loading: id })
    const url = URL.createObjectURL(file)
    try {
      const meta = await probeVideo(url)
      const clip: Clip = {
        id,
        url,
        name: file.name,
        durationMs: meta.durationMs,
        width: meta.width,
        height: meta.height,
        fps: 30,
        offsetMs: 0,
        transform: { ...DEFAULT_TRANSFORM },
        volume: id === 'a' ? 1 : 0,
        envelope: null,
        onset: null,
      }
      set((s) => {
        const clips = { ...s.clips, [id]: clip }
        return { clips, ...withDuration(clips, s.currentMs), loading: null }
      })

      // 音訊分析比較慢,不擋 UI。分析完波形才會出現在時間軸上。
      try {
        const { envelope, onset } = await analyzeAudio(file)
        set((s) => {
          const cur = s.clips[id]
          if (!cur || cur.url !== url) return s // 中途被換掉了
          return { clips: { ...s.clips, [id]: { ...cur, envelope, onset } } }
        })
      } catch {
        set({
          align: {
            status: 'error',
            message: `${file.name} 沒有可解碼的音軌,無法自動對齊`,
            alternativeLagMs: null,
          },
        })
      }
    } catch (err) {
      URL.revokeObjectURL(url)
      set({ loading: null })
      throw err
    }
  },

  removeClip(id) {
    const prev = get().clips[id]
    if (prev) URL.revokeObjectURL(prev.url)
    set((s) => {
      const clips = { ...s.clips, [id]: null }
      return {
        clips,
        ...withDuration(clips, s.currentMs),
        playing: false,
        align: IDLE_ALIGN,
        adjustTarget: s.adjustTarget === id ? null : s.adjustTarget,
      }
    })
  },

  setAspect: (aspect) => set({ aspect }),
  setMode: (mode) => set({ mode }),
  setAdjustTarget: (adjustTarget) => set({ adjustTarget }),
  setOpacity: (opacity) => set({ opacity }),
  setBlend: (blend) => set({ blend }),
  setWipe: (wipe) => set({ wipe }),

  setTransform: (id, patch) =>
    set((s) => {
      const clip = s.clips[id]
      if (!clip) return s
      return {
        clips: {
          ...s.clips,
          [id]: { ...clip, transform: { ...clip.transform, ...patch } },
        },
      }
    }),

  resetTransform: (id) =>
    set((s) => {
      const clip = s.clips[id]
      if (!clip) return s
      return {
        clips: {
          ...s.clips,
          [id]: {
            ...clip,
            // 鏡像是「這支影片本來就左右相反」的模式,不是取景調整。
            // 重設縮放位置時把它一起清掉,動作又會對不上,反而要重按一次。
            transform: { ...DEFAULT_TRANSFORM, mirrored: clip.transform.mirrored },
          },
        },
      }
    }),

  toggleMirror: (id) =>
    set((s) => {
      const clip = s.clips[id]
      if (!clip) return s
      return {
        clips: {
          ...s.clips,
          [id]: {
            ...clip,
            transform: { ...clip.transform, mirrored: !clip.transform.mirrored },
          },
        },
      }
    }),

  setOffset: (id, ms) =>
    set((s) => {
      const clip = s.clips[id]
      if (!clip) return s
      const clips = { ...s.clips, [id]: { ...clip, offsetMs: Math.max(0, ms) } }
      return { clips, ...withDuration(clips, s.currentMs) }
    }),

  nudgeOffset: (id, deltaMs) => {
    const clip = get().clips[id]
    if (clip) get().setOffset(id, clip.offsetMs + deltaMs)
  },

  splitAtPlayhead: () =>
    set((s) => {
      const range = playRange(s)
      // 讀時鐘而非 store.currentMs,後者是 10Hz 的節流鏡像,最多會差三格
      const at = playbackClock.currentMs
      // 切在邊界上等於沒切,兩邊必須都真的有東西
      if (at <= range.startMs || at >= range.endMs) return s
      return { splitAtMs: at }
    }),

  cancelSplit: () => set({ splitAtMs: null }),

  deleteSegment: (side) => {
    const s = get()
    const at = s.splitAtMs
    if (at === null) return

    const inMs = side === 'left' ? at : s.rangeInMs
    const outMs = side === 'left' ? (s.rangeOutMs ?? s.durationMs) : at
    if (outMs - inMs < MIN_RANGE_MS) return

    set({
      previousRange: { inMs: s.rangeInMs, outMs: s.rangeOutMs },
      rangeInMs: inMs,
      // 訖點就是專案結尾時記成 null,之後換更長的影片範圍才會自動延伸
      rangeOutMs: outMs >= s.durationMs ? null : outMs,
      splitAtMs: null,
    })

    // 播放頭如果落在剛剛刪掉的那段裡,把它移到剩下這段的開頭
    const range = playRange(get())
    const at2 = playbackClock.currentMs
    if (at2 < range.startMs || at2 > range.endMs) get().seek(range.startMs)
  },

  undoTrim: () => {
    const prev = get().previousRange
    if (!prev) return
    set({
      rangeInMs: prev.inMs,
      rangeOutMs: prev.outMs,
      previousRange: null,
      splitAtMs: null,
    })
  },

  clearRange: () =>
    set((s) => ({
      previousRange: { inMs: s.rangeInMs, outMs: s.rangeOutMs },
      rangeInMs: 0,
      rangeOutMs: null,
      splitAtMs: null,
    })),

  setVolume: (id, v) =>
    set((s) => {
      const clip = s.clips[id]
      if (!clip) return s
      return { clips: { ...s.clips, [id]: { ...clip, volume: v } } }
    }),

  setFps: (id, fps) =>
    set((s) => {
      const clip = s.clips[id]
      if (!clip) return s
      return { clips: { ...s.clips, [id]: { ...clip, fps } } }
    }),

  seek: (ms) =>
    set((s) => {
      const currentMs = Math.max(0, Math.min(ms, s.durationMs))
      // 時鐘與 store 一起更新,否則使用者拖完時間軸後引擎會把畫面拉回舊位置
      playbackClock.currentMs = currentMs
      return { currentMs }
    }),
  setPlaying: (playing) => set({ playing }),
  togglePlay: () =>
    set((s) => {
      if (s.playing || s.durationMs <= 0) return { playing: false }
      const range = playRange(s)
      // 播放頭在輸出範圍外(或剛好停在結尾)時,從範圍開頭播。
      // 不這樣做的話按下播放會立刻又停住,看起來像壞掉。
      if (s.currentMs < range.startMs || s.currentMs >= range.endMs - 10) {
        playbackClock.currentMs = range.startMs
        return { playing: true, currentMs: range.startMs }
      }
      return { playing: true }
    }),
  setRate: (rate) => set({ rate }),

  stepFrame: (dir) => {
    const s = get()
    const fps = s.clips.a?.fps ?? s.clips.b?.fps ?? 30
    set({ playing: false })
    // 讀時鐘而不是 s.currentMs —— 後者是 10Hz 的節流鏡像,
    // 播放中按逐幀的話最多會差 100ms,等於跳了三格
    s.seek(playbackClock.currentMs + (dir * 1000) / fps)
  },

  addAnnotation: () =>
    set((s) => {
      const size = ASPECT_SIZES[s.aspect]
      const ann: Annotation = {
        id: crypto.randomUUID(),
        // 同樣讀時鐘,標註才會落在使用者真正看到的那一格
        timeMs: playbackClock.currentMs,
        durationMs: 2000,
        text: '新標註',
        x: 0.5,
        y: 0.85,
        color: '#fbbf24',
        // 跟著短邊縮放,換比例時字級才不會忽大忽小
        fontSize: Math.round(Math.min(size.w, size.h) * 0.045),
      }
      return {
        annotations: [...s.annotations, ann].sort((a, b) => a.timeMs - b.timeMs),
        selectedAnnotation: ann.id,
      }
    }),

  updateAnnotation: (id, patch) =>
    set((s) => ({
      annotations: s.annotations
        .map((a) => (a.id === id ? { ...a, ...patch } : a))
        .sort((a, b) => a.timeMs - b.timeMs),
    })),

  removeAnnotation: (id) =>
    set((s) => ({
      annotations: s.annotations.filter((a) => a.id !== id),
      selectedAnnotation: s.selectedAnnotation === id ? null : s.selectedAnnotation,
    })),

  selectAnnotation: (selectedAnnotation) => set({ selectedAnnotation }),

  autoAlign() {
    const { clips } = get()
    const a = clips.a
    const b = clips.b
    if (!a || !b) return
    if (!a.onset || !b.onset) {
      set({
        align: {
          status: 'error',
          message: '音訊還在分析中,請稍候',
          alternativeLagMs: null,
        },
      })
      return
    }
    const onsetA = a.onset
    const onsetB = b.onset

    set({ align: { status: 'running', message: '比對音訊中…', alternativeLagMs: null } })

    // 讓 running 狀態先畫出來,再做同步的重運算
    setTimeout(() => {
      try {
        const t0 = performance.now()
        const { lagMs, score, hasAlternative, runnerUpLagMs } = alignOnsets(
          onsetA,
          onsetB,
        )
        const elapsed = Math.round(performance.now() - t0)

        get().applyLag(lagMs)

        const detail = `相關係數 ${score.toFixed(2)}、耗時 ${elapsed}ms`
        set({
          align: {
            status: score < MIN_SCORE ? 'warn' : 'done',
            message:
              score < MIN_SCORE
                ? `偏移 ${(lagMs / 1000).toFixed(2)}s,但相關係數只有 ${score.toFixed(2)},兩段音訊可能不是同一首歌。`
                : `偏移 ${(lagMs / 1000).toFixed(2)}s(${detail})`,
            alternativeLagMs: hasAlternative ? runnerUpLagMs : null,
          },
        })
      } catch (err) {
        set({
          align: {
            status: 'error',
            message: err instanceof Error ? err.message : '對齊失敗',
            alternativeLagMs: null,
          },
        })
      }
    }, 30)
  },

  applyLag(lagMs) {
    // lagMs 的定義是 offsetB - offsetA,把比較早開始的那段釘在 0
    get().setOffset('a', lagMs < 0 ? -lagMs : 0)
    get().setOffset('b', lagMs > 0 ? lagMs : 0)
  },
}))
