import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import type { ClipId } from '../types'

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
  return { ...base, decodable: true }
}

function describeUndecodable(codec: string | null): string {
  if (codec === 'hevc') {
    return 'HEVC(H.265)—— iPhone 預設錄這個,但多數瀏覽器的 WebCodecs 解不開'
  }
  if (codec === 'av1') return 'AV1 —— 這個瀏覽器的 WebCodecs 沒有 AV1 解碼器'
  if (!codec) return '無法辨識視訊編碼'
  return `${codec.toUpperCase()} —— 這個瀏覽器的 WebCodecs 解不開`
}

/** 把多支素材的檢查結果整理成一句話,用來說明為什麼退回即時錄製 */
export function summariseBlockers(probes: DecodeProbe[]): string | null {
  const blocked = probes.filter((p) => !p.decodable)
  if (blocked.length === 0) return null
  return blocked
    .map((p) => `影片 ${p.id.toUpperCase()} 是 ${p.reason ?? '無法解碼'}`)
    .join(';')
}
