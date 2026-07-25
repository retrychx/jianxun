import { useRef, useEffect } from 'react'
import { Cpu, TrendingUp, Globe, Scale, Users, Trophy, Film, Gamepad2, Heart, BookOpen, Ellipsis } from 'lucide-react'
import type { CategoryCount } from '../api'

interface Props {
  categories: CategoryCount[]
  active: string
  onSelect: (cat: string) => void
}

const CATEGORY_ICONS: Record<string, typeof Cpu> = {
  AI: Cpu, 科技: Cpu, 财经: TrendingUp, 国际: Globe,
  政治: Scale, 社会: Users, 体育: Trophy, 娱乐: Film,
  游戏: Gamepad2, 健康: Heart, 教育: BookOpen, 其他: Ellipsis,
}

export function CategoryBar({ categories, active, onSelect }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const allCategories = [{ name: '全部', count: 0 }, ...categories]

  useEffect(() => {
    if (!listRef.current) return
    const activeEl = listRef.current.querySelector('.tab-item.active') as HTMLElement | null
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' })
    }
  }, [active])

  return (
    <div className="tab-bar">
      <div className="tab-list" ref={listRef}>
        {allCategories.map(c => {
          const Icon = c.name === '全部' ? null : (CATEGORY_ICONS[c.name] || Ellipsis)
          const isActive = active === c.name
          return (
            <button
              key={c.name}
              className={`tab-item ${isActive ? 'active' : ''}`}
              onClick={() => onSelect(c.name)}
            >
              {Icon && <Icon size={13} className="tab-icon" />}
              <span className="tab-label">{c.name}</span>
              {c.count > 0 && <span className="tab-count">{c.count}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
