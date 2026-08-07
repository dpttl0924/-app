import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Panel({
  title,
  right,
  children,
}: {
  title: string
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-white/60 uppercase">
          {title}
        </h2>
        {right}
      </header>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost'
  active?: boolean
}

export function Button({
  variant = 'default',
  active,
  className = '',
  ...rest
}: ButtonProps) {
  // min-h-9 是觸控目標的底線;touch-manipulation 拿掉手機上的 300ms 點擊延遲
  const base =
    'inline-flex min-h-9 items-center justify-center rounded-md px-3 text-xs font-medium transition touch-manipulation select-none disabled:cursor-not-allowed disabled:opacity-40'
  const styles = {
    default: 'bg-white/10 hover:bg-white/20 text-white/90',
    primary: 'bg-indigo-500 hover:bg-indigo-400 text-white',
    ghost: 'hover:bg-white/10 text-white/70',
  }[variant]
  const activeStyle = active ? 'ring-2 ring-indigo-400 bg-indigo-500/25' : ''
  return <button className={`${base} ${styles} ${activeStyle} ${className}`} {...rest} />
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
}) {
  return (
    <label className="block">
      <div className="mb-0.5 flex justify-between text-[11px] text-white/50">
        <span>{label}</span>
        <span className="tabular-nums text-white/70">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        className="h-6 w-full touch-none"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-0.5 text-[11px] text-white/50">{label}</div>
      {children}
    </label>
  )
}

// text-base 在 iOS Safari 是必要的:字級小於 16px 時,聚焦輸入框會自動放大整個頁面
export const inputClass =
  'min-h-9 w-full rounded-md bg-black/40 px-2 py-1.5 text-base text-white/90 ring-1 ring-white/10 outline-none focus:ring-indigo-400 sm:text-xs'
