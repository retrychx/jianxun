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
  return (
    <div className="category-bar">
      <button className={`cat-chip ${active === '全部' ? 'active' : ''}`} onClick={() => onSelect('全部')}>
        全部
      </button>
      {categories.map(c => {
        const Icon = CATEGORY_ICONS[c.name] || Ellipsis
        return (
          <button
            key={c.name}
            className={`cat-chip ${active === c.name ? 'active' : ''}`}
            onClick={() => onSelect(c.name)}
          >
            <Icon size={13} />
            {c.name}
            <span className="cat-count">{c.count}</span>
          </button>
        )
      })}
    </div>
  )
}
