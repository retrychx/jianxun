export const CATEGORY_COLORS: Record<string, string> = {
  AI: '#b91c1c', 科技: '#1d4ed8', 财经: '#047857',
  国际: '#b91c1c', 政治: '#9a3412', 社会: '#9a3412',
  体育: '#166534', 娱乐: '#a16207', 游戏: '#115e59',
  健康: '#9d174d', 教育: '#3f6212', 其他: '#737373',
}

export function categoryColor(name: string): string {
  return CATEGORY_COLORS[name] || CATEGORY_COLORS['其他']
}
