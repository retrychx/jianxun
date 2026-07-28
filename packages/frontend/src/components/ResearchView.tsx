import { useState, useEffect } from 'react'
import { Search, BookOpen, ExternalLink, ChevronDown, ChevronRight, Hash, GitBranch, Newspaper } from 'lucide-react'
import { researchNews, getNarratives, type ResearchReport, type ResearchRef, type NarrativeSummary } from '../api'
import { displayTitle, decodeEntities, type Lang } from '../utils'

interface Props {
  query: string
  lang: Lang
  onNewsClick: (id: number) => void
  onBack: () => void
}

export function ResearchView({ query, lang, onNewsClick, onBack }: Props) {
  const [report, setReport] = useState<ResearchReport | null>(null)
  const [refs, setRefs] = useState<ResearchRef[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0]))
  const [showRefs, setShowRefs] = useState(false)
  const [relatedNarratives, setRelatedNarratives] = useState<NarrativeSummary[]>([])
  const followUps = [
    '核心风险是什么？',
    '未来 6 个月趋势预测',
    '主要玩家优劣势对比',
  ]

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    Promise.all([
      researchNews(query),
      getNarratives().catch(() => ({ narratives: [] })),
    ]).then(([res, narrData]) => {
      if (cancelled) return
      setReport(res.report)
      setRefs(res.refs || [])
      // 查找与研究主题相关的叙事
      const q = query.toLowerCase()
      const related = (narrData.narratives || []).filter(n =>
        (n.label || n.keyword || '').toLowerCase().includes(q)
      ).slice(0, 4)
      setRelatedNarratives(related)
      setLoading(false)
    }).catch(() => {
      if (!cancelled) { setError(true); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [query])

  const toggleSection = (i: number) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  if (loading) {
    return (
      <div className="research-view">
        <div className="research-header">
          <h2 className="research-title"><BookOpen size={18} /> 深度研究</h2>
        </div>
        <div className="research-loading">
          <div className="skeleton" style={{ height: 24, width: '60%', marginBottom: 12, borderRadius: 4 }} />
          <div className="skeleton" style={{ height: 16, marginBottom: 20, borderRadius: 4 }} />
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton" style={{ height: 100, marginBottom: 10, borderRadius: 'var(--radius)' }} />
          ))}
        </div>
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="research-view">
        <div className="research-header">
          <button className="back-btn" onClick={onBack} style={{ marginRight: 10 }}><ChevronRight size={18} style={{ transform: 'rotate(180deg)' }} /></button>
          <h2 className="research-title"><BookOpen size={18} /> 深度研究</h2>
        </div>
        <div className="empty" style={{ marginTop: 32 }}>
          <Search size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
          <p>暂无足够资料生成报告</p>
          <p style={{ fontSize: 13, marginTop: 4, color: 'var(--text-tertiary)' }}>试试换个角度提问</p>
        </div>
      </div>
    )
  }

  return (
    <div className="research-view">
      <div className="research-header">
        <button className="back-btn" onClick={onBack} style={{ marginRight: 10 }}><ChevronRight size={18} style={{ transform: 'rotate(180deg)' }} /></button>
        <div>
          <h2 className="research-title"><BookOpen size={18} /> {report.title}</h2>
          <div className="research-sub">{report.summary}</div>
        </div>
      </div>

      {/* Sections */}
      <div className="research-sections">
        {report.sections.map((section, i) => {
          const isOpen = expandedSections.has(i)
          return (
            <div key={i} className={`research-card ${isOpen ? 'open' : ''}`}>
              <button className="research-card-trigger" onClick={() => toggleSection(i)}>
                <div className="research-card-heading">
                  <span className="research-card-num">{i + 1}</span>
                  <span>{section.heading}</span>
                </div>
                {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
              {isOpen && (
                <div className="research-card-body">
                  <p className="research-card-text">{section.body}</p>
                  {section.refs.length > 0 && (
                    <div className="research-card-refs">
                      {section.refs.map(refIdx => {
                        const ref = refs.find(r => r.ref === refIdx)
                        if (!ref) return null
                        return (
                          <button key={refIdx} className="research-ref-tag" onClick={() => onNewsClick(ref.id)}>
                            [{refIdx}] {ref.titleZh || ref.title} <small>{ref.source}</small>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Outlook */}
      {report.outlook && (
        <div className="research-outlook">
          <h3 className="research-outlook-title">展望</h3>
          <p>{report.outlook}</p>
        </div>
      )}

      {/* 关联故事 */}
      {relatedNarratives.length > 0 && (
        <div className="nd-related-section" style={{ marginTop: 20 }}>
          <h3 className="nd-section-title">关联故事</h3>
          <div className="nd-related-list">
            {relatedNarratives.map(n => (
              <a key={n.keyword} href={`#/narrative/${encodeURIComponent(n.keyword)}`} className="nd-related-card clickable">
                <div className="nd-related-top"><GitBranch size={14} className="nd-related-icon" /><span className="nd-related-label">{decodeEntities((n.label || n.keyword).replace(/^__\w+__/, '').replace(/^[🔴⚡📖📍]\s*/, '').trim())}</span></div>
                <div className="nd-related-meta"><span>{n.articleCount} 篇</span></div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* 继续研究 */}
      <div className="research-followups">
        <h3 className="nd-section-title">继续研究</h3>
        <div className="research-followup-grid">
          {followUps.map(suggestion => (
            <a key={suggestion} href={`#/research?q=${encodeURIComponent(suggestion)}`} className="research-followup-chip">
              <Search size={12} /> {suggestion}
            </a>
          ))}
        </div>
      </div>

      {/* References footer */}
      {refs.length > 0 && (
        <div className="research-refs-footer">
          <button className="research-reftoggle" onClick={() => setShowRefs(!showRefs)}>
            {showRefs ? '收起' : '展开'}全部引用（{refs.length} 篇）
            <ChevronDown size={13} style={{ transform: showRefs ? 'rotate(180deg)' : '', transition: '.15s' }} />
          </button>
          {showRefs && (
            <div className="research-refs-list">
              {refs.map(ref => (
                <button key={ref.ref} className="research-ref-row" onClick={() => onNewsClick(ref.id)}>
                  <span className="research-ref-idx">[{ref.ref}]</span>
                  <span className="research-ref-title">{ref.titleZh || ref.title}</span>
                  <span className="research-ref-source">{ref.source}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
