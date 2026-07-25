import { useEffect, useState } from 'react'

interface Props {
  fetching: boolean
}

const FACES = ['◕', '◔', '◡', '⊙', '◠']
const COLORS = ['#b91c1c', '#1d4ed8', '#047857', '#b45309', '#6b21a8']

export function FetchMascot({ fetching }: Props) {
  const [face, setFace] = useState(0)
  const [colorIdx, setColorIdx] = useState(0)
  const [dots, setDots] = useState('')
  const isRetro = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'retro'
  const [tape, setTape] = useState('')

  useEffect(() => {
    if (!fetching) return
    const faceTimer = setInterval(() => setFace(f => (f + 1) % FACES.length), 400)
    const colorTimer = setInterval(() => setColorIdx(i => (i + 1) % COLORS.length), 600)
    const dotsTimer = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 500)

    // Telegram tape effect for retro
    if (isRetro) {
      const chars = '■■□□□□□□□□'
      let pos = 0
      const tapeTimer = setInterval(() => {
        pos = (pos + 1) % chars.length
        setTape(chars.slice(pos) + chars.slice(0, pos))
      }, 150)
      return () => { clearInterval(faceTimer); clearInterval(colorTimer); clearInterval(dotsTimer); clearInterval(tapeTimer); setDots('') }
    }

    return () => { clearInterval(faceTimer); clearInterval(colorTimer); clearInterval(dotsTimer); setDots('') }
  }, [fetching, isRetro])

  if (!fetching) return null

  return (
    <div className="mascot-overlay">
      {isRetro ? (
        <div className="mascot-telegram">
          <div className="telegram-box">
            <div className="telegram-header">
              <span className="telegram-dot" />
              <span className="telegram-dot" />
              <span className="telegram-dot" />
            </div>
            <div className="telegram-body">
              <div className="telegram-label">RECEIVING</div>
              <div className="telegram-tape">{tape}</div>
              <div className="telegram-label">{dots}</div>
            </div>
            <div className="telegram-footer">
              <span className="telegram-time">LTR 1926-07-25</span>
              <span className="telegram-no">{String(Math.floor(Math.random() * 9999)).padStart(4, '0')}</span>
            </div>
          </div>
          <div className="mascot-text" style={{ marginTop: 12 }}>
            <span className="mascot-label">收报中</span>
            <span className="mascot-dots">{dots}</span>
          </div>
        </div>
      ) : (
        <div className="mascot-box">
          <div className="mascot-avatar" style={{ background: COLORS[colorIdx] }}>
            <svg viewBox="0 0 40 40" className="mascot-svg">
              <rect x="4" y="4" width="32" height="32" rx="8" fill="rgba(255,255,255,.15)" />
              <rect x="12" y="14" width="4" height="5" rx="1" fill="#fff" />
              <rect x="24" y="14" width="4" height="5" rx="1" fill="#fff" />
              <circle cx="14" cy={16 + Math.sin(Date.now() / 300) * 1.5} r="1.5" fill="#1a1a1a" />
              <circle cx="26" cy={16 + Math.sin(Date.now() / 300) * 1.5} r="1.5" fill="#1a1a1a" />
              <path d="M14 26 Q20 30 26 26" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <circle cx="10" cy="24" r="2.5" fill="rgba(255,255,255,.12)" />
              <circle cx="30" cy="24" r="2.5" fill="rgba(255,255,255,.12)" />
            </svg>
          </div>
          <div className="mascot-text">
            <span className="mascot-label">寻找有趣新闻</span>
            <span className="mascot-dots">{dots}</span>
          </div>
        </div>
      )}
    </div>
  )
}
