/**
 * 素材格率的量測與吸附。
 *
 * 刻意不依賴 mediabunny:這裡會在**載入素材時**跑,而 mediabunny 是動態載入的
 * 那 107KB —— 為了量一個 fps 把整個 demuxer 拉進載入階段不划算。
 * 改用 `requestVideoFrameCallback` 直接跟瀏覽器要每一格的呈現時間。
 */

/** 常見的拍攝格率。實測值會有小數誤差,靠過去比較不會被雜訊帶偏。 */
const COMMON_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120]

/** 量不出來時的退路。大多數手機錄影是這個。 */
export const DEFAULT_FPS = 30

/**
 * 把實測格率吸附到最接近的常見格率。
 *
 * 量出來的值會是 29.9993 之類的數字;直接拿去用的話,累積誤差會讓取樣點
 * 慢慢漂過影格邊界 —— 那本身就會造成偶發的重複格。
 */
export function snapToCommonRate(measured: number): number | null {
  if (!Number.isFinite(measured) || measured <= 0) return null
  let best: number | null = null
  let bestDiff = Infinity
  for (const rate of COMMON_RATES) {
    const diff = Math.abs(measured - rate)
    if (diff < bestDiff) {
      bestDiff = diff
      best = rate
    }
  }
  // 差太多就相信實測值,別硬套(例如刻意的 15fps 縮時)
  return bestDiff <= 1.5 ? best : Math.round(measured * 1000) / 1000
}

/** 從一串影格呈現時間(秒)推格率。少於兩格就量不出來。 */
export function fpsFromFrameTimes(times: number[]): number | null {
  const deltas: number[] = []
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1]
    // 同一格被回報兩次(seek 之後很常見)不算間隔
    if (d > 1e-6) deltas.push(d)
  }
  if (deltas.length < 2) return null

  // 用中位數而不是平均:開頭幾格常常不規律(解碼器還在暖機),
  // 平均會被那幾個離群值整個帶偏,中位數不會。
  deltas.sort((a, b) => a - b)
  const median = deltas[Math.floor(deltas.length / 2)]
  if (!(median > 0)) return null
  return snapToCommonRate(1 / median)
}

interface FrameMeta {
  mediaTime: number
}
type RVFC = (cb: (now: number, meta: FrameMeta) => void) => number

/** 這個瀏覽器有沒有 requestVideoFrameCallback */
export function supportsFrameCallback(el: HTMLVideoElement): boolean {
  return typeof (el as unknown as { requestVideoFrameCallback?: RVFC })
    .requestVideoFrameCallback === 'function'
}

/**
 * 分頁在背景時先等它回到前景。
 *
 * Chrome 會把「沒有聲音的媒體」在背景分頁暫停以省電,`play()` 會直接被
 * AbortError 打回來,`requestVideoFrameCallback` 也就永遠不會觸發。
 * 使用者選完檔案就切到別的分頁是很常見的動作,不處理的話量測會靜靜地失敗。
 */
function waitForVisible(timeoutMs: number): Promise<boolean> {
  if (!document.hidden) return Promise.resolve(true)
  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onChange)
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve(false)
    }, timeoutMs)
    const onChange = () => {
      if (!document.hidden) {
        cleanup()
        resolve(true)
      }
    }
    document.addEventListener('visibilitychange', onChange)
  })
}

/**
 * 實測這支影片的格率。量不出來回傳 null,呼叫端自己決定退路。
 *
 * 做法是靜音播一小段,用 `requestVideoFrameCallback` 收每一格的 `mediaTime`
 * (影片自己時間軸上的呈現時間),再取間隔的中位數。
 * 靜音是必要的:沒有使用者手勢時,只有靜音播放不會被自動播放政策擋下來。
 *
 * @param sampleFrames 要收幾格。太少會被暖機的不規律帶偏,太多就是讓使用者多等。
 * @param timeoutMs 收不滿也要收手 —— 有些檔案根本不會觸發回呼
 */
export async function measureFps(
  el: HTMLVideoElement,
  sampleFrames = 12,
  timeoutMs = 3000,
): Promise<number | null> {
  if (!supportsFrameCallback(el)) return null
  if (!(await waitForVisible(30_000))) return null

  const video = el as unknown as { requestVideoFrameCallback: RVFC }
  const times: number[] = []

  return new Promise<number | null>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      el.pause()
      resolve(fpsFromFrameTimes(times))
    }
    const timer = setTimeout(finish, timeoutMs)

    const onFrame = (_now: number, meta: FrameMeta) => {
      times.push(meta.mediaTime)
      if (times.length >= sampleFrames) finish()
      else video.requestVideoFrameCallback(onFrame)
    }

    video.requestVideoFrameCallback(onFrame)
    el.muted = true
    // 播不起來(自動播放被擋、或根本沒有視訊軌)就靠 timeout 收尾
    void el.play().catch(finish)
  })
}

/**
 * 量一個 blob: URL 的格率,自己開一個離線的 video 元素。
 *
 * 刻意獨立於載入流程:量測要真的播一小段,而且分頁在背景時得等回到前景,
 * 掛在載入路徑上會讓「選了檔案卻遲遲沒反應」。呼叫端在背景跑,量到了再補。
 */
export async function measureClipFps(url: string): Promise<number | null> {
  const el = document.createElement('video')
  el.preload = 'auto'
  el.muted = true
  el.playsInline = true
  el.src = url
  try {
    const ready = await new Promise<boolean>((resolve) => {
      el.onloadedmetadata = () => resolve(el.videoWidth > 0)
      el.onerror = () => resolve(false)
    })
    // 純音檔沒有畫面可量
    if (!ready) return null
    return await measureFps(el)
  } finally {
    el.removeAttribute('src')
    el.load()
  }
}
