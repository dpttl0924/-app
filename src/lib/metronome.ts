/**
 * 預備拍的節拍器聲音。
 *
 * 用 Web Audio 排程而不是 requestAnimationFrame 觸發:
 * rAF 的時間點會抖 ±16ms,而預備拍的重點就是準 —— 抖成那樣還不如不要。
 * `osc.start(when)` 是取樣級精準的。
 *
 * 同一套排程給預覽與匯出共用。匯出時輸出節點會多接一條到錄音用的
 * MediaStreamDestination,click 才會進到檔案裡。
 */

/** 重音與弱拍的頻率,聽得出強弱才數得下去 */
const ACCENT_HZ = 1600
const NORMAL_HZ = 1000
const CLICK_SECONDS = 0.04
/** 每幾拍一個重音 */
const BEATS_PER_BAR = 4

/**
 * 第幾聲是重音(index 從 0 開始數)。
 *
 * 重音落在每組的「最後一拍」—— 第 4、8、12、16 聲,不是第一拍。
 * 數 5、6、7、8 的時候「8」才是「下一拍就要進」的提示;
 * 重音放在開頭反而跟接下來的動作對不上。
 * 這樣也保證最後一聲一定是重音,而那正好是歌曲第一個重拍的前一拍。
 */
export function isAccent(index: number): boolean {
  return (index + 1) % BEATS_PER_BAR === 0
}

/**
 * 產生一聲 click。預覽(即時)與匯出(離線)共用同一份。
 *
 * 這個函式存在的理由是先前兩邊各寫了一次:改音色或重音規則時
 * 很容易只改到其中一邊,而那種不一致要聽了才會發現。
 *
 * whenSec 是 AudioContext 的絕對時間,即時與離線都適用。
 */
export function createClick(
  ctx: BaseAudioContext,
  index: number,
  whenSec: number,
  volume: number,
  destinations: AudioNode[],
): OscillatorNode {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.value = isAccent(index) ? ACCENT_HZ : NORMAL_HZ
  // 直接切斷會有 pop 聲,用短斜坡收尾
  gain.gain.setValueAtTime(0.0001, whenSec)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), whenSec + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, whenSec + CLICK_SECONDS)

  osc.connect(gain)
  for (const d of destinations) gain.connect(d)
  osc.start(whenSec)
  osc.stop(whenSec + CLICK_SECONDS + 0.01)
  return osc
}

export interface ScheduledMetronome {
  /** 取消所有還沒響的 click */
  cancel: () => void
}

/**
 * 把一串 click 排進 AudioContext。
 *
 * @param clickTimesMs 每一聲相對於「排程起點」的毫秒數
 * @param startOffsetMs 排程起點目前已經過了多久(播放頭在預備拍中間時用)
 * @param destinations 要送到哪些節點。預覽是喇叭,匯出時再多一個錄音節點。
 */
export function scheduleClicks(
  ctx: AudioContext,
  clickTimesMs: number[],
  {
    startOffsetMs = 0,
    volume = 0.6,
    rate = 1,
    destinations,
  }: {
    startOffsetMs?: number
    volume?: number
    rate?: number
    destinations: AudioNode[]
  },
): ScheduledMetronome {
  const nodes: OscillatorNode[] = []
  const base = ctx.currentTime

  clickTimesMs.forEach((tMs, index) => {
    // 播放頭已經越過的那幾聲不用補放
    const aheadMs = (tMs - startOffsetMs) / rate
    if (aheadMs < -1e-6) return
    const at = base + aheadMs / 1000
    nodes.push(createClick(ctx, index, at, volume, destinations))
  })

  return {
    cancel: () => {
      for (const osc of nodes) {
        try {
          osc.stop()
        } catch {
          // 已經停過就算了
        }
      }
      nodes.length = 0
    },
  }
}
