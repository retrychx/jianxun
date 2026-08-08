/** Phase 2+3: AI article analysis and category refinement. */

import { extractContent, analyzeWithDeepSeek, batchClassify } from '../analysis/deepseek.js'
import { likeEscape, type Env } from '../helpers.js'
import { loadMemory } from './memory.js'
import { CONFIG } from './config.js'
import { subrequestsUsed } from './state.js'

/** Analyze recent high-score articles with enhanced DeepSeek prompt. */
export async function analyzeNewArticles(env: Env, limit = 10, signal?: AbortSignal): Promise<number> {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return 0

  // 学习反馈：从记忆读热门实体（用户点击多），标题命中的文章优先分析
  let hotNames: string[] = []
  try {
    const mem = await loadMemory(env)
    hotNames = Object.entries(mem.entityHeat)
      .filter(([, v]) => v.clicks >= 2)
      .sort(([, a], [, b]) => b.clicks - a.clicks)
      .slice(0, 10)
      .map(([k]) => k)
  } catch {}

  // 窗口用 CONFIG.analyze.windowDays（7 天）：让积压能被排空，而不是 2 天后直接掉落
  const windowExpr = `datetime('now', '-${CONFIG.analyze.windowDays} days')`
  let query: string
  let params: any[]
  if (hotNames.length) {
    const esc = hotNames.map(n => `%${likeEscape(n)}%`)
    const clauses = hotNames.map(() => "(title LIKE ? ESCAPE '\\')").join(' OR ')
    query = `SELECT id, url, title, description FROM news
      WHERE analyzed_at IS NULL AND analyze_attempts < 3 AND published_at >= ${windowExpr}
      ORDER BY CASE WHEN ${clauses} THEN 1 ELSE 0 END DESC, score DESC LIMIT ?`
    params = [...esc, limit]
  } else {
    query = `SELECT id, url, title, description FROM news WHERE analyzed_at IS NULL AND analyze_attempts < 3 AND published_at >= ${windowExpr} ORDER BY score DESC LIMIT ?`
    params = [limit]
  }
  const rows = await env.DB.prepare(query).bind(...params).all<any>()
  const pending = rows.results || []

  // 限并发分析：60 篇并行 8 路，配合 300s 阶段超时。
  // 并发 DeepSeek 调用由 fetchWithRetry 的 429 重试兜底。
  // 限并发分析：60 篇并行 2 路，配合 300s 阶段超时。
  // CONCURRENCY 从 8 降到 2：并发 worker 会在同一个预算检查点全部放行，8 路时
  // 在途请求能把 subrequest 预算顶到 cap+16，直接饿死后面的日报/叙事。降到 2 后
  // 在途 ≤2 篇 × 2 次 ≈ 4 个 subrequest 的超出量，可预测。
  const CONCURRENCY = 2
  let done = 0
  const queue = [...pending]
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        // 免费版 50 外部 subrequest/调用是硬上限。analyze 是最大消耗方（每篇 1~2 次），
        // 不能让它独吞预算：超过分析专用预算就停手，把剩余额度留给 critical 的日报/叙事。
        if (subrequestsUsed() >= CONFIG.analyze.subrequestBudget) {
          console.log(`[agent] analyze hit subrequest budget (${subrequestsUsed()}) — stop early, deferring ${queue.length} articles`)
          break
        }
        const row = queue.shift()!
        if (await analyzeOne(env, row, apiKey, signal)) done++
      }
    }),
  )
  return done
}

/** 分析单篇文章（限并发池内执行）；成功返回 true */
async function analyzeOne(env: Env, row: any, apiKey: string, signal?: AbortSignal): Promise<boolean> {
  await env.DB.prepare('UPDATE news SET analyze_attempts = analyze_attempts + 1 WHERE id = ?').bind(row.id).run()
  try {
    // RSS description 足够长时跳过全文抓取（节省 6s/article）
    let extracted: string | null = null, pageTitle: string | null = null
    if (!row.description || row.description.length < 100) {
      const result = await extractContent(row.url)
      extracted = result.content
      pageTitle = result.title
    }
    const content = (extracted || row.description || row.title).slice(0, 2000)
    const result = await analyzeWithDeepSeek(row.title, content, apiKey, pageTitle, signal)
    if (result) {
      await env.DB.prepare(
        `UPDATE news SET summary=?, entities=?, sentiment=?, category=?, content=COALESCE(?,content),
         analyzed_at=datetime('now'), analysis_detail=? WHERE id=?`
      ).bind(result.base.summary, JSON.stringify(result.base.entities), JSON.stringify(result.base.sentiment),
        result.base.category || '科技', extracted, JSON.stringify(result.detail), row.id).run()
      return true
    }
  } catch (e: any) { console.error('[analyze] article analysis failed:', e?.message) }
  return false
}

/** DeepSeek batch reclassify low-confidence articles. */
export async function refineCategories(env: Env, signal?: AbortSignal) {
  const apiKey = env.DEEPSEEK_API_KEY
  if (!apiKey) return { refined: 0 }
  const rows = await env.DB.prepare(
    "SELECT id, title, category FROM news WHERE category = '科技' AND score = 50 AND analyze_attempts > 0 ORDER BY RANDOM() LIMIT 40"
  ).all<any>()
  const batch = (rows.results || []); if (!batch.length) return { refined: 0 }
  let refined = 0
  for (let i = 0; i < batch.length; i += 10) {
    const chunk = batch.slice(i, i + 10)
    try {
      const results = await batchClassify(chunk.map(a => ({ id: a.id, title: a.title })), apiKey, signal)
      for (const r of results) { if (r.index >= 0 && r.index < chunk.length && r.category && chunk[r.index].category !== r.category) { await env.DB.prepare('UPDATE news SET category = ? WHERE id = ?').bind(r.category, chunk[r.index].id).run(); refined++ } }
    } catch (e: any) { console.error('[analyze] article analysis failed:', e?.message) }
  }
  return { refined }
}
