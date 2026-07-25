import { useId } from 'react'

// 选中态指示线：折几下的手绘笔画，两端渐隐（stroke 用 currentColor，跟随链接色）
// 每个实例独立的 gradient id：否则移动端 display:none 的 header-nav 里第一个同名
// 渐变会被 url() 优先解析到，而隐藏子树里的 paint server 不生效
export function KinkLine() {
  const id = 'kg' + useId().replace(/:/g, '')
  return (
    <svg className="kink-line" width="34" height="8" viewBox="0 0 34 8" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="0.35" stopColor="currentColor" stopOpacity="1" />
          <stop offset="0.65" stopColor="currentColor" stopOpacity="1" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M1 6 L9 2.5 L16 6.5 L24 2 L33 5.5"
        stroke={`url(#${id})`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}
