/**
 * Agent Quality Assurance — 自检分析质量，标记低质量输出。
 */
import type { Env } from '../helpers.js'

/** 批量标记低质量文章以便重分析 */
export async function flagLowQualityAnalyses(env: Env): Promise<number> {
  const rows = await env.DB.prepare(`
    SELECT id, summary, entities, analyzed_at
    FROM news WHERE analyzed_at IS NOT NULL
    AND analyze_attempts < 3
    AND (
      (summary IS NULL OR length(summary) < 10 OR entities IS NULL OR entities = '[]')
      -- AI 反馈闭环：用户点过"不感兴趣"的文章也纳入重分析
      OR id IN (SELECT CAST(target_id AS INTEGER) FROM signals
                WHERE target_type='article' AND action='hide'
                  AND created_at >= datetime('now', '-7 days'))
    )
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
  const rows = await env.DB.prepare(
    "SELECT id, keyword, label, summary, article_ids, developments, source_stats FROM narratives WHERE status = 'active'"
  ).all<any>()
  const narratives = rows.results || []
  let merged = 0
  for (let i = 0; i < narratives.length; i++) {
    if (!narratives[i]) continue
    let idsA: number[] = JSON.parse(narratives[i].article_ids || '[]')
    let setA = new Set(idsA)
    for (let j = i + 1; j < narratives.length; j++) {
      if (!narratives[j]) continue
      const idsB: number[] = JSON.parse(narratives[j].article_ids || '[]')
      // 如果文章重叠 ≥ 60%，合并
      let overlap = 0
      for (const id of idsB) if (setA.has(id)) overlap++
      const maxSize = Math.max(idsA.length, idsB.length)
      if (maxSize > 0 && overlap / maxSize >= 0.6) {
        // 合并到第一个叙事（不只是 article_ids——developments/source_stats/summary 一并合并，
        // 否则被归档方的进展直接丢失）
        const mergedIds = [...new Set([...idsA, ...idsB])]
        let devsA: any[] = []; try { devsA = JSON.parse(narratives[i].developments || '[]'); if (!Array.isArray(devsA)) devsA = [] } catch { devsA = [] }
        let devsB: any[] = []; try { devsB = JSON.parse(narratives[j].developments || '[]'); if (!Array.isArray(devsB)) devsB = [] } catch { devsB = [] }
        const srcsA: Record<string, number> = (() => { try { return JSON.parse(narratives[i].source_stats || '{}') } catch { return {} } })()
        const srcsB: Record<string, number> = (() => { try { return JSON.parse(narratives[j].source_stats || '{}') } catch { return {} } })()
        for (const d of devsB) if (!devsA.some(x => JSON.stringify(x) === JSON.stringify(d))) devsA.push(d)
        for (const [s, c] of Object.entries(srcsB)) srcsA[s] = (srcsA[s] || 0) + (c as number)
        const summary = (narratives[i].summary || '').length >= (narratives[j].summary || '').length
          ? narratives[i].summary : narratives[j].summary
        await env.DB.prepare(
          "UPDATE narratives SET article_ids = ?, developments = ?, source_stats = ?, summary = ? WHERE id = ?"
        ).bind(JSON.stringify(mergedIds), JSON.stringify(devsA), JSON.stringify(srcsA), summary, narratives[i].id).run()
        // 删除被合并的
        await env.DB.prepare("UPDATE narratives SET status = 'archived' WHERE id = ?").bind(narratives[j].id).run()
        narratives[j] = null!
        // 更新 A 的当前集合，使同一叙事连续合并时用最新重叠数据，而不是过期快照
        idsA = mergedIds
        setA = new Set(mergedIds)
        merged++
      }
    }
  }
  return merged
}
