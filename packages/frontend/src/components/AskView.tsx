import { useEffect, useRef, useState } from 'react'
import { ArrowUp, History, MessageCircleQuestion, SearchX, X, BookOpen } from 'lucide-react'
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

const SUGGESTIONS = [
  '本周 OpenAI 有什么新动向？',
  'DeepSeek 最近怎么了？',
  'AI 裁员潮涉及哪些公司？',
]

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

// AI 问答浮窗：对话形态——问题气泡、衬线回答、建议问题、底部输入条
export function AskView({ open, initialQuestion, lang, onNewsClick, onClose, onResearch }: Props) {
  const [question, setQuestion] = useState('')
  const [current, setCurrent] = useState('')
  const [result, setResult] = useState<AskResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState(false)
  const [history, setHistory] = useState<string[]>(loadHistory)
  const seq = useRef(0)
  const slowTimer = useRef<number | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  const submit = async (raw: string) => {
    const q = raw.trim()
    if (q.length < 2 || q.length > 60 || loading) return
    setQuestion('')
    setCurrent(q)
    setResult(null)
    setError(false)
    setLoading(true)
    setSlow(false)
    const s = ++seq.current
    // Show "still processing" hint after 8 seconds
    if (slowTimer.current) clearTimeout(slowTimer.current)
    slowTimer.current = window.setTimeout(() => { if (s === seq.current) setSlow(true) }, 8_000)
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
      if (s === seq.current) { setLoading(false); setSlow(false) }
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

  // Cleanup slow timer on unmount
  useEffect(() => () => { if (slowTimer.current) clearTimeout(slowTimer.current) }, [])

  // 新内容滚到底部
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [current, loading, result, error])

  if (!open) return null
  const idle = !current && !loading && !result && !error

  return (
    <>
      <div className="ask-backdrop" onClick={onClose} />
      <div className="ask-widget" role="dialog" aria-label="问问简讯" aria-modal="true">
        <div className="ask-widget-handle" />
        <div className="ask-widget-head">
          <div className="ask-widget-title"><MessageCircleQuestion size={15} />问问简讯</div>
          <button className="ask-widget-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </div>

        <div className="ask-thread" ref={threadRef}>
          {idle && (
            <div className="ask-welcome">
              <p className="ask-welcome-text">基于近 7 天的报道回答，附引用来源。试试：</p>
              <div className="ask-suggestions">
                {SUGGESTIONS.map(s => (
                  <button key={s} className="ask-suggestion" onClick={() => submit(s)}>{s}</button>
                ))}
              </div>
              {history.length > 0 && (
                <>
                  <div className="ask-history-label"><History size={12} /> 最近提问</div>
                  <div className="ask-suggestions">
                    {history.map(h => (
                      <button key={h} className="ask-suggestion ask-history-item" onClick={() => submit(h)}>{h}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {current && <div className="ask-msg-user">{current}</div>}

          {loading && (
            <div className="ask-msg-ai ask-typing" aria-label="正在生成回答">
              <span /><span /><span />
              {slow && <div className="ask-typing-slow">仍在处理中，请稍候...</div>}
            </div>
          )}

          {error && <div className="ask-msg-ai ask-msg-error">回答生成失败，请稍后重试</div>}

          {!loading && !error && result && (
            result.answer ? (
              <div className="ask-msg-ai">
                <AnswerText text={result.answer} refs={result.refs} onNewsClick={onNewsClick} />
            {result.answer && onResearch && (
              <button className="ask-research-btn" onClick={() => onResearch(question)}>
                <BookOpen size={13} /> 深度研究这个话题
              </button>
            )}
                {result.refs.length > 0 && (
                  <div className="ask-refs">
                    {result.refs.map(r => (
                      <article key={r.ref} className="ask-ref-card" onClick={() => onNewsClick(r.id)}>
                        <span className="ask-ref-num">{r.ref + 1}</span>
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
              <div className="ask-msg-ai ask-msg-error">
                <SearchX size={18} />
                近 7 天没有找到与「{current}」相关的报道，换个问题试试
              </div>
            )
          )}
        </div>

        <div className="ask-composer">
          <input
            className="ask-input"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(question) }}
            placeholder="问一个最近新闻的问题..."
            maxLength={60}
            aria-label="提问"
          />
          <button
            className="ask-send"
            onClick={() => submit(question)}
            disabled={loading || question.trim().length < 2}
            aria-label="发送"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </>
  )
}
