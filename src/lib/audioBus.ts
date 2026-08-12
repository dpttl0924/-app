/**
 * 全站共用的 AudioContext 與匯出用的混音節點。
 *
 * 為什麼要有這個模組:
 *   1. `createMediaElementSource` 對同一個 <video> 只能呼叫一次,再呼叫就 throw,
 *      所以必須把建立過的節點快取起來。
 *   2. 一旦建立,該 element 的聲音就改走 Web Audio,得自己接回喇叭。
 *   3. 匯出要把「影片的聲音」和「節拍器的 click」混在一起錄進同一條音軌,
 *      兩者都得接到同一個 MediaStreamDestination。
 *
 * Safari 沒有實作 HTMLMediaElement.captureStream(),所以這條 Web Audio 路徑
 * 不只是備案,在 iPhone 上是唯一能拿到聲音的方法 —— 而手機正是主要使用場景。
 */

let ctx: AudioContext | null = null
const elementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()

export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

/** 瀏覽器的自動播放政策會讓 context 卡在 suspended,使用者一有動作就要喚醒 */
export async function resumeAudio(): Promise<void> {
  const ac = audioContext()
  if (ac.state === 'suspended') {
    try {
      await ac.resume()
    } catch {
      // 沒有使用者手勢就喚不醒,等下一次
    }
  }
}

/**
 * 取得某個 media element 的 Web Audio 來源節點。
 * 第一次呼叫時順便接回喇叭,否則影片會突然沒聲音。
 */
export function sourceFor(el: HTMLMediaElement): MediaElementAudioSourceNode | null {
  const ac = audioContext()
  const cached = elementSources.get(el)
  if (cached) return cached
  try {
    const node = ac.createMediaElementSource(el)
    node.connect(ac.destination)
    elementSources.set(el, node)
    return node
  } catch {
    // 已經被別人接走,或這個 element 不支援
    return null
  }
}
