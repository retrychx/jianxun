import { useEffect, useState } from 'react'
import { Lightbulb, TrendingUp } from 'lucide-react'

interface Idea {
  signal: string
  title: string
  concept: string
  whyNow: string
  audience: string
}

interface IdeasResponse {
  date: string | null
  ideas: Idea[]
}

// 每日产品灵感：agent 基于当天热门新闻生成的 1-3 个可孵化 demo 的想法
export function IdeasView() {
  const [data, setData] = useState<IdeasResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(false)
    fetch('/api/news/product-ideas').then(r => r.json()).then(d => {
      if (!cancelled) setData(d)
    }).catch(() => { if (!cancelled) setError(true) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) return (
    <div className="ideas-view">
      <div className="nv-header"><h2 className="nv-title">每日灵感</h2></div>
      {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 110, marginBottom: 10, borderRadius: 'var(--radius)' }} />)}
    </div>
  )

  const ideas = data?.ideas || []

  return (
    <div className="ideas-view">
      <div className="nv-header">
        <div>
          <h2 className="nv-title">每日灵感</h2>
          <p className="nv-subtitle">
            {data?.date ? `${data.date} · 基于当天热门新闻生成` : 'Agent 每天基于热门新闻生成 1-3 个可孵化 demo 的产品想法'}
          </p>
        </div>
      </div>

      {error ? (
        <div className="empty" style={{ marginTop: 40 }}><p>灵感数据加载失败</p></div>
      ) : ideas.length === 0 ? (
        <div className="empty" style={{ marginTop: 40 }}>
          <Lightbulb size={28} style={{ opacity: .3, marginBottom: 8 }} />
          <p>今天的灵感还在生成中</p>
          <p style={{ fontSize: 13, marginTop: 4, color: 'var(--text-tertiary)' }}>Agent 会在下一次运行后生成</p>
        </div>
      ) : (
        ideas.map((idea, i) => (
          <div key={i} className="idea-card">
            <div className="idea-rank">{i + 1}</div>
            <div className="idea-body">
              <h3 className="idea-title">{idea.title}</h3>
              <p className="idea-concept">{idea.concept}</p>
              <div className="idea-meta">
                <span className="idea-signal"><TrendingUp size={11} /> {idea.signal}</span>
                {idea.whyNow && <span className="idea-why">为什么现在：{idea.whyNow}</span>}
                {idea.audience && <span className="idea-audience">目标用户：{idea.audience}</span>}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
