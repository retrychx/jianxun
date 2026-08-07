export const CATEGORY_COLORS: Record<string, string> = {
  AI: '#b91c1c', 科技: '#1d4ed8', 财经: '#047857',
  国际: '#b91c1c', 政治: '#9a3412', 社会: '#9a3412',
  体育: '#166534', 娱乐: '#a16207', 游戏: '#115e59',
  健康: '#9d174d', 教育: '#3f6212', 其他: '#737373',
}

export function categoryColor(name: string): string {
  return CATEGORY_COLORS[name] || CATEGORY_COLORS['其他']
}

// 来源可信度（基础分类，后续可由 agent 动态调整）
export const HIGH_TRUST_SOURCES = [
  '36氪', '量子位', '虎嗅', '钛媒体', '爱范儿', '品玩', '雷锋网', '动点科技', '中国新闻网', 'IT之家', '凤凰网科技',
  'MIT Tech Review', 'The Verge', 'TechCrunch', 'Ars Technica', 'Wired', 'New Scientist', 'Simon Willison', 'Quanta Magazine', 'IEEE Spectrum',
]

export function sourceTrust(source: string): { score: number; label: string } {
  if (HIGH_TRUST_SOURCES.includes(source)) return { score: 4, label: '可靠' }
  return { score: 2, label: '一般' }
}
