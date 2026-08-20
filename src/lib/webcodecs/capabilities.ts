import {
  canEncodeVideo,
  canEncodeAudio,
  type AudioCodec,
  type VideoCodec,
} from 'mediabunny'

/**
 * 這台裝置的 WebCodecs 能力偵測。
 *
 * 為什麼一定要在執行時偵測而不是寫死:
 *
 * H.264 編碼不是每個瀏覽器都有。實測這台開發用的 Chromium 就只支援 VP9/VP8,
 * 而 **WebM 在 iOS Safari 播不了** —— 主要客群正是 iPhone 使用者。
 * 偵測不到 H.264 時應該退回 MediaRecorder,而不是產出一個使用者打不開的檔案。
 */

export type OutputContainer = 'mp4' | 'webm'

export interface CodecChoice {
  container: OutputContainer
  video: VideoCodec
  /** null = 這台裝置沒有裝得進這個容器的音訊編碼器,輸出無聲 */
  audio: AudioCodec | null
  /** 副檔名與 MIME,給下載用 */
  extension: string
  mimeType: string
}

export interface Capabilities {
  /** 這個瀏覽器有沒有 WebCodecs 的編碼 API */
  hasWebCodecs: boolean
  /** 各個視訊編碼器能不能用,依偏好排序 */
  video: { codec: VideoCodec; supported: boolean }[]
  audio: { codec: AudioCodec; supported: boolean }[]
  /** 最終會用哪一組。null = 無法用 WebCodecs 匯出,要退回 MediaRecorder。 */
  choice: CodecChoice | null
  /**
   * 產出的檔案 iPhone 播得了嗎。
   * WebM 在 iOS Safari 播不了,對這個專案來說等於白做。
   */
  playableOnIphone: boolean
}

/**
 * 視訊編碼器的偏好順序。
 *
 * H.264 排最前面不是因為畫質最好(VP9/AV1 都更好),而是因為**相容性**:
 * 只有 H.264/MP4 是 iPhone、Android、桌機瀏覽器全部都能播的組合。
 * 這個 App 的產出是要拿去分享的,播不了的檔案畫質再好也沒意義。
 */
const VIDEO_PREFERENCE: VideoCodec[] = ['avc', 'vp9', 'vp8', 'av1']
const AUDIO_PREFERENCE: AudioCodec[] = ['aac', 'opus']

/** 哪些視訊編碼可以裝進 MP4 */
const MP4_VIDEO: VideoCodec[] = ['avc', 'hevc', 'av1', 'vp9']
/** 哪些音訊編碼可以裝進 MP4 */
const MP4_AUDIO: AudioCodec[] = ['aac', 'opus']

/** 測試用的解析度。太小的話有些編碼器會回報支援但實際跑不動。 */
const PROBE_SIZE = { width: 1080, height: 1920 }

export async function detectCapabilities(): Promise<Capabilities> {
  const hasWebCodecs =
    typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined'

  if (!hasWebCodecs) {
    return {
      hasWebCodecs: false,
      video: [],
      audio: [],
      choice: null,
      playableOnIphone: false,
    }
  }

  const video = await Promise.all(
    VIDEO_PREFERENCE.map(async (codec) => ({
      codec,
      supported: await canEncodeVideo(codec, PROBE_SIZE).catch(() => false),
    })),
  )
  const audio = await Promise.all(
    AUDIO_PREFERENCE.map(async (codec) => ({
      codec,
      supported: await canEncodeAudio(codec).catch(() => false),
    })),
  )

  const choice = pickChoice(video, audio)
  return {
    hasWebCodecs: true,
    video,
    audio,
    choice,
    playableOnIphone: choice?.container === 'mp4' && choice.video === 'avc',
  }
}

function pickChoice(
  video: { codec: VideoCodec; supported: boolean }[],
  audio: { codec: AudioCodec; supported: boolean }[],
): CodecChoice | null {
  const bestVideo = video.find((v) => v.supported)?.codec
  if (!bestVideo) return null
  const bestAudio = audio.find((a) => a.supported)?.codec ?? null

  // 視訊編碼決定容器 —— 裝不進 MP4 的就只能用 Matroska/WebM
  const container: OutputContainer = MP4_VIDEO.includes(bestVideo) ? 'mp4' : 'webm'

  // 音訊也要塞得進同一個容器,塞不進就不要音軌。
  //
  // 這裡不能拿一個「預設值」墊檔:編不出來的 codec 要等到 addAudioTrack()
  // 才炸,那時候使用者已經等了一整段編碼,而且只會看到一句跟音訊無關的錯誤。
  // 寧可安靜地輸出無聲 —— 畫面通常才是重點,與 MediaRecorder 那條路一致。
  const audioFits =
    bestAudio !== null && (container === 'webm' || MP4_AUDIO.includes(bestAudio))

  return {
    container,
    video: bestVideo,
    audio: audioFits ? bestAudio : null,
    extension: container === 'mp4' ? 'mp4' : 'webm',
    mimeType: container === 'mp4' ? 'video/mp4' : 'video/webm',
  }
}

/*
  outputFormatFor() 搬到 videoExport.ts 了。

  它要 import 封裝器(Mp4OutputFormat / WebMOutputFormat),而封裝器會把
  mediabunny 的大半拉進這個模組。這個檔案只是「偵測能不能編」,一載入素材
  就會跑;真正需要封裝器的是按下匯出之後。留在這裡的話,只是看一眼
  編碼能力就得先下載整個 muxer。
*/
