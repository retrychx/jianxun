/**
 * Agent Quality Assurance — 自检分析质量，标记低质量输出。
 */
import type { QualityCheck } from './types.js'
import type { Env } from '../helpers.js'

/** 检查单篇文章分析的完整性 */
export function checkAnalysisQuality(result: any): QualityCheck {
  const issues: string[] = []

  // 摘要检查
  const summary = result?.base?.summary || ''
  if (summary.length < 10) issues.push('摘要过短')
  if (summary === '无法生成摘要' || summary.startsWith('无法')) issues.push('摘要生成失败')
  if (summary.includes('```') || summary.includes('{')) issues.push('摘要含代码/JSON')

  // 实体检查
  const entities = result?.base?.entities || []
  if (entities.length === 0) issues.push('未提取实体')

  // 分类检查
  const validCats = ['AI', '科技', '财经', '国际', '政治', '健康', '体育', '娱乐', '游戏', '教育', '社会']
  const cat = result?.base?.category || ''
  if (!validCats.includes(cat)) issues.push(`分类异常: ${cat}`)

  // 情感检查
  const sentLabel = result?.base?.sentiment?.label || ''
  if (!['positive', 'negative', 'neutral', 'mixed'].includes(sentLabel)) issues.push('情感标签异常')

  const passed = issues.length === 0
  const score = passed ? 1.0 : Math.max(0, 1.0 - issues.length * 0.3)

  return {
    passed,
    score,
    issues,
    suggestion: passed ? 'accept' : score > 0.4 ? 'flag' : 'retry',
  }
}

/** 检查叙事进展的质量 */
export function checkNarrativeQuality(text: string): QualityCheck {
  const issues: string[] = []
  if (!text || text.length < 20) issues.push('进展文字过短')
  if (text.includes('```')) issues.push('含代码块')
  if (text.includes('未能') || text.includes('无法')) issues.push('可能生成失败')
  return {
    passed: issues.length === 0,
    score: issues.length === 0 ? 1.0 : 0.3,
    issues,
    suggestion: issues.length === 0 ? 'accept' : 'retry',
  }
}

/** 批量标记低质量文章以便重分析 */
export async function flagLowQualityAnalyses(env: Env): Promise<number> {
  const rows = await env.DB.prepare(`
    SELECT id, summary, entities, analyzed_at
    FROM news WHERE analyzed_at IS NOT NULL
    AND (summary IS NULL OR length(summary) < 10 OR entities IS NULL OR entities = '[]')
    AND analyze_attempts < 3
    LIMIT 20
  `).all<any>()
  let flagged = 0
  for (const row of (rows.results || [])) {
    // 重置为未分析状态，允许重试
    await env.DB.prepare(
      "UPDATE news SET analyzed_at = NULL, analyze_attempts = analyze_attempts + 1 WHERE id = ?"
    ).bind(row.id).run()
    flagged++
  }
  return flagged
}

/** 检测并合并重叠叙事 */
export async function mergeOverlappingNarratives(env: Env): Promise<number> {
  const rows = await env.DB.prepare("SELECT id, keyword, label, article_ids FROM narratives WHERE status = 'active'").all<any>()
  const narratives = rows.results || []
  let merged = 0
  for (let i = 0; i < narratives.length; i++) {
    if (!narratives[i]) continue
    const idsA: number[] = JSON.parse(narratives[i].article_ids || '[]')
    const setA = new Set(idsA)
    for (let j = i + 1; j < narratives.length; j++) {
      if (!narratives[j]) continue
      const idsB: number[] = JSON.parse(narratives[j].article_ids || '[]')
      // 如果文章重叠 ≥ 60%，合并
      let overlap = 0
      for (const id of idsB) if (setA.has(id)) overlap++
      const maxSize = Math.max(idsA.length, idsB.length)
      if (maxSize > 0 && overlap / maxSize >= 0.6) {
        // 合并到第一个叙事
        const mergedIds = [...new Set([...idsA, ...idsB])]
        await env.DB.prepare(
          "UPDATE narratives SET article_ids = ? WHERE id = ?"
        ).bind(JSON.stringify(mergedIds), narratives[i].id).run()
        // 删除被合并的
        await env.DB.prepare("UPDATE narratives SET status = 'archived' WHERE id = ?").bind(narratives[j].id).run()
        narratives[j] = null!
        merged++
      }
    }
  }
  return merged
}
