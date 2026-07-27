import { Sunrise, Newspaper, Hash, GitBranch, TrendingUp } from 'lucide-react'
import { KinkLine } from './KinkLine'
import type { ViewName } from '../hooks/useHashRoute'

const TABS: { view: ViewName; hash: string; label: string; Icon: typeof Sunrise }[] = [
  { view: 'briefing', hash: '#/', label: '日报', Icon: Sunrise },
  { view: 'feed', hash: '#/feed', label: '新闻', Icon: Newspaper },
  { view: 'topics', hash: '#/topics', label: '话题', Icon: Hash },
  { view: 'narratives', hash: '#/narratives', label: '叙事', Icon: GitBranch },
]

// 移动端底部 tab bar（≤768px 显示，桌面端由 header + sidebar 承担导航）
export function BottomNav({ active }: { active: ViewName }) {
  return (
    <nav className="bottom-nav" aria-label="主导航">
      {TABS.map(t => {
        const isActive = active === t.view
        return (
          <a
            key={t.view}
            href={t.hash}
            className={`bottom-nav-item${isActive ? ' active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
          >
            <t.Icon size={20} />
            <span className="bottom-nav-label">{t.label}</span>
            <KinkLine />
          </a>
        )
      })}
    </nav>
  )
}
