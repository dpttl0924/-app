import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny'
import type { InputVideoTrack } from 'mediabunny'
import type { ClipId } from '../types'
// 吸附邏輯與載入時的量測共用一份,兩邊不該對「29.97 算不算 30」有不同意見
import { snapToCommonRate } from '../frameRate'

/**
 * 這支素材能不能走 WebCodecs 解碼。
 *
 * 為什麼需要單獨檢查:`<video>` 播得動不代表 `VideoDecoder` 解得開 ——
 * 兩者走的是不同的解碼路徑。最典型的就是 iPhone 的 HEVC:
 * Safari 的 `<video>` 播得很順,但多數瀏覽器的 WebCodecs 解不了。
 *
 * 不先檢查的話,失敗會在匯出跑到一半才炸出一句「Decoding error」,
 * 使用者完全不知道是哪一支素材、什麼編碼、能怎麼辦。
 */

export interface DecodeProbe {
  id: ClipId
  /** 容器格式,例如 MP4 / Matroska */
  container: string | null
  /** 視訊編碼,例如 avc / hevc / vp9。null = 沒有視訊軌(純音檔) */
  videoCodec: string | null
  /** 純音檔不需要視訊解碼,一律視為可用 */
  audioOnly: boolean
  decodable: boolean
  /** 不能解碼時的原因,已經是可以直接顯示給使用者的句子 */
  reason: string | null
  /**
   * 實測的來源格率。null = 量不出來。
   *
   * 載入時存的 `clip.fps` 是寫死的 30,從來沒真的量過 ——
   * 素材其實是 24 或 25fps 的話,強制用 30fps 輸出會產生 pulldown judder
   * (2-3-2-3 的重複/跳格),看起來就是「有一支影片會卡」。
   * 網頁預覽是照素材原生格率播的,所以只有匯出看得到。
   */
  fps: number | null
  /** 影格實際時間分佈。null = 量不出來。 */
  timing: FrameTiming | null
}

export interface FrameTiming {
  sampled: number
  medianDeltaMs: number
  minDeltaMs: number
  maxDeltaMs: number
  /** 影格間隔的 10 百分位 —— 這支素材「最快」的瞬時速率,決定要多高的輸出格率才接得住 */
  fastDeltaMs: number
  /** 間隔明顯偏離中位數的影格比例 */
  irregularRatio: number
  /** true = VFR,重新取樣成固定格率會頓 */
  variable: boolean
}

export async function probeDecodability(
  id: ClipId,
  blob: Blob,
): Promise<DecodeProbe> {
  const base: DecodeProbe = {
    id,
    container: null,
    videoCodec: null,
    audioOnly: false,
    decodable: false,
    reason: null,
    fps: null,
    timing: null,
  }

  let input: Input
  try {
    input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) })
  } catch {
    return { ...base, reason: '無法讀取這個檔案的格式' }
  }

  try {
    base.container = (await input.getFormat()).name
  } catch {
    return { ...base, reason: '無法辨識容器格式' }
  }

  let track
  try {
    track = await input.getPrimaryVideoTrack()
  } catch {
    return { ...base, reason: '無法讀取視訊軌' }
  }

  // 純音檔:畫面走佔位波形,不需要視訊解碼
  if (!track) {
    return { ...base, audioOnly: true, decodable: true }
  }

  base.videoCodec = track.codec ?? null

  let ok = false
  try {
    ok = await track.canDecode()
  } catch {
    ok = false
  }

  if (!ok) {
    return { ...base, reason: describeUndecodable(base.videoCodec) }
  }

  try {
    const stats = await track.computePacketStats(120)
    base.fps = snapToCommonRate(stats.averagePacketRate)
  } catch {
    base.fps = null
  }

  base.timing = await analyseFrameTiming(track)

  return { ...base, decodable: true }
}

/** 影格間隔偏離中位數超過這個比例就算不規則 */
const IRREGULAR_TOLERANCE = 0.2
/** 超過這個比例的影格不規則,就當作 VFR */
const VFR_THRESHOLD = 0.05
const SAMPLE_PACKETS = 400

/**
 * 量影格的實際時間分佈,判斷是不是 VFR(可變格率)。
 *
 * 為什麼要分開量:`averagePacketRate` 只給平均值,VFR 的素材平均起來
 * 也可能剛好是 29.97,看起來跟 CFR 沒兩樣。但它每一格的間隔是不規則的 ——
 * 手機錄影很常這樣(省電降格、對焦時掉格)。
 *
 * 原生播放照每格自己的 PTS 走,所以再不規則都很順;
 * 一旦重新取樣成固定格率,不規則的地方就會變成重複格或跳格,也就是「頓」。
 * 兩支素材只有一支是 VFR 的話,就只有那一支會頓 —— 這正是難查的地方。
 */
export async function analyseFrameTiming(
  track: InputVideoTrack,
): Promise<FrameTiming | null> {
  const times: number[] = []
  try {
    const sink = new EncodedPacketSink(track)
    let packet = await sink.getFirstPacket()
    while (packet && times.length < SAMPLE_PACKETS) {
      times.push(packet.timestamp)
      packet = await sink.getNextPacket(packet)
    }
  } catch {
    return null
  }

  // 解碼順序不等於顯示順序(B-frame),要排過才能算間隔
  times.sort((a, b) => a - b)
  const deltas: number[] = []
  for (let i = 1; i < times.length; i++) deltas.push(times[i] - times[i - 1])
  if (deltas.length < 10) return null

  const sorted = [...deltas].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  if (median <= 0) return null

  const irregular = deltas.filter(
    (d) => Math.abs(d - median) / median > IRREGULAR_TOLERANCE,
  ).length

  // 用 10 百分位而不是最小值當「最快速率」:PTS 偶爾會有兩格幾乎重疊的離群值,
  // 拿它去推格率會得到 200fps 這種沒有意義的數字
  const fast = sorted[Math.floor(sorted.length * 0.1)]

  return {
    sampled: deltas.length,
    medianDeltaMs: Math.round(median * 100000) / 100,
    minDeltaMs: Math.round(sorted[0] * 100000) / 100,
    maxDeltaMs: Math.round(sorted[sorted.length - 1] * 100000) / 100,
    fastDeltaMs: Math.round(fast * 100000) / 100,
    irregularRatio: irregular / deltas.length,
    variable: irregular / deltas.length > VFR_THRESHOLD,
  }
}

function describeUndecodable(codec: string | null): string {
  if (codec === 'hevc') {
    return 'HEVC(H.265)—— iPhone 預設錄這個,但多數瀏覽器的 WebCodecs 解不開'
  }
  if (codec === 'av1') return 'AV1 —— 這個瀏覽器的 WebCodecs 沒有 AV1 解碼器'
  if (!codec) return '無法辨識視訊編碼'
  return `${codec.toUpperCase()} —— 這個瀏覽器的 WebCodecs 解不開`
}

/**
 * 素材格率的說明。純粹是資訊,沒什麼好講的時候回傳 null。
 *
 * 這裡刻意**不再**警告「格率除不盡會頓」。舊版要先選一個固定的輸出格率,
 * 所以格率不同就一定有一支要被重新取樣,只能事先道歉;
 * 現在合成時間軸是由兩支素材的影格時刻決定的(見 composite.ts),
 * 格率不同、甚至是 VFR,都是一格對一格,沒有東西要警告。
 */
export function summariseRates(probes: DecodeProbe[]): string | null {
  const measured = probes.filter((p) => p.fps !== null)
  if (measured.length === 0) return null

  const parts = measured.map(
    (p) =>
      `影片 ${p.id.toUpperCase()} ${p.fps}fps${p.timing?.variable ? '(可變格率)' : ''}`,
  )
  const mixed =
    measured.some((p) => p.timing?.variable) ||
    new Set(measured.map((p) => p.fps)).size > 1

  return (
    parts.join('、') +
    (mixed
      ? '。輸出走可變格率,兩支都是一格對一格,不會有重複或跳格。'
      : '。')
  )
}

/** 把多支素材的檢查結果整理成一句話,用來說明為什麼退回即時錄製 */
export function summariseBlockers(probes: DecodeProbe[]): string | null {
  const blocked = probes.filter((p) => !p.decodable)
  if (blocked.length === 0) return null
  return blocked
    .map((p) => `影片 ${p.id.toUpperCase()} 是 ${p.reason ?? '無法解碼'}`)
    .join(';')
}
