// GET /api/news/sectors — 行业雷达：赛道 + 公司竞争格局 + 热度走势
import { json, tryCatch } from '../../../src/handler'

// 赛道关键词映射（粗粒度，后续可扩充）
const SECTORS: Record<string, { label: string; keywords: string[] }> = {
  'AI芯片': { label: 'AI 芯片', keywords: ['英伟达', 'NVIDIA', 'AMD', 'Blackwell', 'GPU', '昇腾', '寒武纪', '海光'] },
  '大模型': { label: '大模型', keywords: ['GPT', 'Claude', 'Gemini', 'LLaMA', 'Qwen', 'DeepSeek', 'Kimi', 'GLM', '大模型', 'LLM'] },
  '自动驾驶': { label: '自动驾驶', keywords: ['自动驾驶', 'Robotaxi', '萝卜快跑', '特斯拉', 'FSD', 'L4', '激光雷达'] },
  '人形机器人': { label: '人形机器人', keywords: ['人形机器人', '具身智能', 'Figure', '特斯拉Optimus', '宇树', 'Figure AI'] },
  '消费电子': { label: '消费电子', keywords: ['iPhone', 'iPad', 'Apple Watch', '智能手机', '折叠屏', 'AR', 'VR', 'MR'] },
  '云计算': { label: '云计算', keywords: ['AWS', 'Azure', '谷歌云', '阿里云', '腾讯云', '云计算', 'SaaS'] },
  '新能源': { label: '新能源', keywords: ['宁德时代', '比亚迪', '特斯拉', '电池', '锂电', '固态电池'] },
  '生物科技': { label: '生物科技', keywords: ['AI制药', '创新药', '基因', 'mRNA', '生物科技'] },
}

export async function onRequestGet(context: any) {
  return tryCatch(async () => {
  const { env } = context

  // 最近 7 天文章
  const rows: any = await env.DB.prepare(`
    SELECT title, entities, source, published_at FROM news
    WHERE created_at >= datetime('now', '-7 days')
    AND entities IS NOT NULL AND entities != ''
    LIMIT 500
  `).all()
  const articles = (rows.results || []) as any[]

  const sectors: any[] = []

  for (const [key, sector] of Object.entries(SECTORS)) {
    const kws = sector.keywords.map(k => k.toLowerCase())
    // 匹配该赛道的文章
    const matched: any[] = []
    const entityCount = new Map<string, number>()
    const sourceCount = new Map<string, number>()
    const heatByDay = new Map<string, number>()

    for (const a of articles) {
      let text = (a.title || '').toLowerCase()
      try {
        const parsed = typeof a.entities === 'string' ? JSON.parse(a.entities) : a.entities
        if (Array.isArray(parsed)) {
          for (const e of parsed) {
            if (e?.name) text += ' ' + String(e.name).toLowerCase()
          }
        }
      } catch {}

      if (!kws.some(k => text.includes(k))) continue
      matched.push(a)

      // 实体计数
      try {
        const parsed = typeof a.entities === 'string' ? JSON.parse(a.entities) : a.entities
        if (Array.isArray(parsed)) {
          for (const e of parsed) {
            const name = e?.name?.trim()
            if (name && name.length >= 2) entityCount.set(name, (entityCount.get(name) || 0) + 1)
          }
        }
      } catch {}
      // 来源计数
      if (a.source) sourceCount.set(a.source, (sourceCount.get(a.source) || 0) + 1)
      // 按天热度
      if (a.published_at) {
        const day = a.published_at.slice(0, 10)
        heatByDay.set(day, (heatByDay.get(day) || 0) + 1)
      }
    }

    if (matched.length < 2) continue

    // 主要参与者（实体按出现次数）
    const players = [...entityCount.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, count]) => ({ name, count }))

    sectors.push({
      key,
      label: sector.label,
      articleCount: matched.length,
      sourceCount: sourceCount.size,
      players,
      heatTrend: [...heatByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date: date.slice(5), count })),
    })
  }

  sectors.sort((a, b) => b.articleCount - a.articleCount)

  return json({ sectors })
  })
}
