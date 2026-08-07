/** 原地 radix-2 FFT。n 必須是 2 的次方。 */
export function fftInPlace(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length
  if (n <= 1) return
  if ((n & (n - 1)) !== 0) throw new Error('FFT 長度必須是 2 的次方')

  // 位元反轉重排
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let j = 0; j < half; j++) {
        const ur = re[i + j]
        const ui = im[i + j]
        const xr = re[i + j + half]
        const xi = im[i + j + half]
        const vr = xr * cr - xi * ci
        const vi = xr * ci + xi * cr
        re[i + j] = ur + vr
        im[i + j] = ui + vi
        re[i + j + half] = ur - vr
        im[i + j + half] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n
      im[i] /= n
    }
  }
}

export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

/**
 * 用 FFT 算循環互相關:r[k] = Σ a[t+k] · b[t]
 *
 * 直接算是 O(n²) —— 兩段 3 分鐘的 100Hz 包絡各 18000 點,要 3.24 億次乘法。
 * 走 FFT 是 O(n log n),同樣資料量約 65 萬次,快三個數量級。
 *
 * 回傳長度 N 的陣列,索引 k <= N/2 代表正的 lag,k > N/2 代表 lag = k - N。
 */
export function crossCorrelate(a: Float32Array, b: Float32Array): Float64Array {
  const n = nextPow2(a.length + b.length)
  const ar = new Float64Array(n)
  const ai = new Float64Array(n)
  const br = new Float64Array(n)
  const bi = new Float64Array(n)
  ar.set(a)
  br.set(b)

  fftInPlace(ar, ai, false)
  fftInPlace(br, bi, false)

  // A · conj(B)
  for (let i = 0; i < n; i++) {
    const cr = ar[i] * br[i] + ai[i] * bi[i]
    const ci = ai[i] * br[i] - ar[i] * bi[i]
    ar[i] = cr
    ai[i] = ci
  }

  fftInPlace(ar, ai, true)
  return ar
}
