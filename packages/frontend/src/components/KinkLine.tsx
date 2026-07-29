import { useId } from 'react'

// 选中态指示线：铅印线（Printer's Rule）
// 灵感来自宽幅报纸的 column rule——活版印刷压出来的红痕
// 动画：从中间向两端延展，模仿印刷压痕
// 两端渐隐模拟油墨在纸面上的自然扩散

export function KinkLine() {
  const id = 'pr' + useId().replace(/:/g, '')
  const filterId = 'pb' + useId().replace(/:/g, '')
  return (
    <svg className="kink-line" width="48" height="12" viewBox="0 0 48 12" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="0.15" stopColor="currentColor" stopOpacity="1" />
          <stop offset="0.85" stopColor="currentColor" stopOpacity="1" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* 主线条 */}
      <path
        d="M4 6 L44 6"
        stroke={`url(#${id})`} strokeWidth="3" strokeLinecap="round"
        className="kink-line-bar"
      />
    </svg>
  )
}
