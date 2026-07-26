import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, History, MessageCircleQuestion, SearchX, X } from 'lucide-react'
import type { AskRef, AskResponse } from '../api'
import { askNews } from '../api'
import { displayTitle, type Lang } from '../utils'

interface Props {
  /** 浮窗是否打开 */
  open: boolean
  /** 外部带入的预填问题（如搜索视图「直接提问」），变化时自动提问一次 */
  initialQuestion?: string
  lang: Lang
  onNewsClick: (id: number) => void
  onClose: () => void
}

const HISTORY_KEY = 'jianxun_ask_history'

function loadHistory(): string[] {
  try {
    const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(data) ? data.filter((s: any) => typeof s === 'string' && s.trim()).slice(0, 5) : []
  } catch { return [] }
}

// 回答正文（衬线）：[n] 渲染成可点击上标，跳对应文章详情；对不上引用的 [n] 按原文显示
function AnswerText({ text, refs, onNewsClick }: { text: string; refs: AskRef[]; onNewsClick: (id: number) => void }) {
  const byRef = new Map(refs.map(r => [r.ref, r]))
  return (
    <p className="ask-answer-text">
      {text.split(/(\[\d+\])/).map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/)
        const ref = m ? byRef.get(Number(m[1])) : undefined
        if (!m || !ref) return <span key={i}>{part}</span>
        return (
          <a
            key={i}
            className="ask-cite"
            href={`#/news/${ref.id}`}
            title={ref.title}
            onClick={e => { e.preventDefault(); onNewsClick(ref.id) }}
          >{m[1]}</a>
        )
      })}
    </p>
  )
}

// AI 问答浮窗：右下角弹出，桌面锚定右下角，移动端近全屏
export function AskView({ open, initialQuestion, lang, onNewsClick, onClose }: Props) {
  const [question, setQuestion] = useState(initialQuestion || '')
  const [current, setCurrent] = useState('')
  const [result, setResult] = useState<AskResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [history, setHistory] = useState<string[]>(loadHistory)
  const seq = useRef(0)

  const submit = async (raw: string) => {
    const q = raw.trim()
    if (q.length < 2 || q.length > 60 || loading) return
    setQuestion(q)
    setCurrent(q)
    setResult(null)
    setError(false)
    setLoading(true)
    const s = ++seq.current
    // 历史：最新在前、去重、最多 5 条
    setHistory(prev => {
      const next = [q, ...prev.filter(h => h !== q)].slice(0, 5)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      return next
    })
    try {
      const res = await askNews(q)
      if (s !== seq.current) return
      setResult(res)
    } catch {
      if (s !== seq.current) return
      setError(true)
    } finally {
      if (s === seq.current) setLoading(false)
    }
  }

  // 外部带问题进来时自动提问
  const askedInitial = useRef('')
  useEffect(() => {
    const q = (initialQuestion || '').trim()
    if (open && q.length >= 2 && askedInitial.current !== q) {
      askedInitial.current = q
      submit(q)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion, open])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const idle = !loading && !result && !error

  return (
    <>
      <div className="ask-backdrop" onClick={onClose} />
      <div className="ask-widget" role="dialog" aria-label="问问简讯" aria-modal="true">
        <div className="ask-widget-head">
          <div className="ask-widget-title">
            <MessageCircleQuestion size={15} />
            问问简讯
            <span className="ask-widget-sub">基于近 7 天的报道回答</span>
          </div>
          <button className="ask-widget-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </div>

        <div className="ask-widget-body">
          <div className="ask-input-row">
            <input
              className="ask-input"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(question) }}
              placeholder="如：本周 OpenAI 有什么新动向？"
              maxLength={60}
              aria-label="提问"
            />
            <button
              className="ask-submit"
              onClick={() => submit(question)}
              disabled={loading || question.trim().length < 2}
              aria-label="提交问题"
            >
              <CornerDownLeft size={15} />
            </button>
          </div>

          {idle && history.length > 0 && (
            <div className="bf-section">
              <div className="bf-section-title"><History size={13} /> 最近提问</div>
              <div className="ask-history-list">
                {history.map(h => (
                  <button key={h} className="ask-history-item" onClick={() => submit(h)}>{h}</button>
                ))}
              </div>
            </div>
          )}

          {loading && <div className="search-hint">正在检索相关报道并生成回答...</div>}

          {error && <div className="search-hint">回答生成失败，请稍后重试</div>}

          {!loading && !error && result && (
            result.answer ? (
              <div className="ask-result">
                <AnswerText text={result.answer} refs={result.refs} onNewsClick={onNewsClick} />
                {result.refs.length > 0 && (
                  <div className="bf-section">
                    <div className="bf-section-title">引用来源</div>
                    {result.refs.map(r => (
                      <article key={r.ref} className="ask-ref-card" onClick={() => onNewsClick(r.id)}>
                        <span className="ask-ref-num">[{r.ref}]</span>
                        <div className="ask-ref-body">
                          <div className="ask-ref-title">{displayTitle(r, lang)}</div>
                          <div className="ask-ref-source">{r.source}</div>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="search-hint">
                <SearchX size={24} style={{ marginBottom: 8 }} />
                <p>近 7 天没有找到与「{current}」相关的报道，换个问题试试</p>
              </div>
            )
          )}
        </div>
      </div>
    </>
  )
}
