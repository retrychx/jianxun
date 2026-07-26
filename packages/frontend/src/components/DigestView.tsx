import { useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Newspaper } from 'lucide-react'
import type { DigestResponse } from '../api'
import { getDigest } from '../api'
import type { FollowItem } from '../hooks/useFollow'
import { categoryColor } from '../constants'
import { displayTitle, formatDigestDate, type Lang } from '../utils'
import { FollowWeekly } from './FollowWeekly'

interface ViewProps {
  digest: DigestResponse
  /** /digests 的历史日期列表，用于顶部箭头与往期入口（可为空，静默降级） */
  dates: string[]
  lang: Lang
  onNewsClick: (id: number) => void
  /** 有关注实体时底部显示「本周关注动态」 */
  follows?: FollowItem[]
  onEntityClick?: (name: string) => void
}

function shortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, (m || 1) - 1, d || 1)
  if (Number.isNaN(date.getTime())) return dateStr
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
}

function DigestSkeleton() {
  return (
    <div className="digest-view">
      <div className="digest-header">
        <div className="skeleton" style={{ height: 22, width: '46%', marginBottom: 14 }} />
        <div className="skeleton skeleton-line mid" />
        <div className="skeleton skeleton-line short" />
      </div>
      {[0, 1, 2].map(i => (
        <div key={i} className="skeleton-card" style={{ marginBottom: 10 }}>
          <div className="skeleton skeleton-line" style={{ height: 16, marginBottom: 10 }} />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line tiny" style={{ marginTop: 10, marginBottom: 0 }} />
        </div>
      ))}
    </div>
  )
}

export function DigestView({ digest, dates, lang, onNewsClick, follows, onEntityClick }: ViewProps) {
  const items = Array.isArray(digest.items) ? digest.items : []
  // 日期列表倒序（新→旧）；当前日期不一定在列表里，按大小关系找相邻
  const sorted = [...new Set(dates)].sort().reverse()
  const newerList = sorted.filter(d => d > digest.date)
  const newer = newerList.length ? newerList[newerList.length - 1] : null
  const older = sorted.find(d => d < digest.date) ?? null

  return (
    <div className="digest-view">
      <div className="digest-header">
        <div className="digest-date-row">
          {older ? (
            <a className="digest-nav" href={`#/digest/${older}`} aria-label="前一期日报">
              <ChevronLeft size={15} />
            </a>
          ) : (
            <span className="digest-nav disabled" aria-hidden="true"><ChevronLeft size={15} /></span>
          )}
          <h2 className="digest-date">{formatDigestDate(digest.date)}</h2>
          {newer ? (
            <a className="digest-nav" href={`#/digest/${newer}`} aria-label="后一期日报">
              <ChevronRight size={15} />
            </a>
          ) : (
            <span className="digest-nav disabled" aria-hidden="true"><ChevronRight size={15} /></span>
          )}
        </div>
        {digest.intro && <p className="digest-intro">{digest.intro}</p>}
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <Newspaper size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
          <p>本期日报暂无内容</p>
        </div>
      ) : (
        <div className="digest-list">
          {items.map((item, i) => (
            <article key={item.id} className="digest-card" onClick={() => onNewsClick(item.id)}>
              <div className="digest-num">{String(i + 1).padStart(2, '0')}</div>
              <div className="digest-body">
                <h3 className="digest-title">{displayTitle(item, lang)}</h3>
                {item.why && <p className="digest-why">{item.why}</p>}
                <div className="digest-meta">
                  <span className="briefing-cat" style={{ backgroundColor: categoryColor(item.category) }}>{item.category}</span>
                  <span className="digest-source">{item.source}</span>
                  {item.heat != null && item.heat > 1 && (
                    <span className="digest-heat">{item.heat} 家媒体报道</span>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {digest.extra && (
        <article className="digest-extra" onClick={() => onNewsClick(digest.extra!.id)}>
          <div className="digest-extra-label">今日番外</div>
          <h3 className="digest-title">{displayTitle(digest.extra, lang)}</h3>
          {digest.extra.why && <p className="digest-why">{digest.extra.why}</p>}
        </article>
      )}

      {older && (
        <a className="digest-archive" href={`#/digest/${older}`}>
          往期日报 · {shortDate(older)} <ChevronRight size={13} />
        </a>
      )}

      {follows && onEntityClick && <FollowWeekly follows={follows} onEntityClick={onEntityClick} />}
    </div>
  )
}

interface LoaderProps {
  /** 指定日期查历史；缺省取最新一期 */
  date?: string
  dates: string[]
  lang: Lang
  onNewsClick: (id: number) => void
  /** 404/失败时的降级视图（主页传 BriefingView；历史页缺省显示空态） */
  fallback?: ReactNode
  /** 有关注实体时底部显示「本周关注动态」 */
  follows?: FollowItem[]
  onEntityClick?: (name: string) => void
}

export function DigestLoader({ date, dates, lang, onNewsClick, fallback, follows, onEntityClick }: LoaderProps) {
  const [digest, setDigest] = useState<DigestResponse | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setDigest(null)
    setFailed(false)
    getDigest(date)
      .then(d => { if (!cancelled) setDigest(d) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [date])

  if (digest) return <DigestView digest={digest} dates={dates} lang={lang} onNewsClick={onNewsClick} follows={follows} onEntityClick={onEntityClick} />
  if (failed) {
    return fallback ? <>{fallback}</> : (
      <div className="empty">
        <Newspaper size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
        <p>该日暂无日报</p>
        <p style={{ fontSize: 13, marginTop: 4 }}>
          <a href="#/" style={{ color: 'var(--accent)' }}>回到最新一期</a>
        </p>
      </div>
    )
  }
  return <DigestSkeleton />
}
