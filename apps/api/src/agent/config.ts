/**
 * Centralized agent configuration — all thresholds, limits, model names,
 * and phase settings in one place.  Import CONFIG from any agent file.
 */

export const CONFIG = {
  deepseek: {
    model: 'deepseek-v4-flash',
    temperature: { analysis: 0.3, classification: 0.05, digest: 0.2, narrative: 0.2, translation: 0.1, storyline: 0.2, crossRef: 0.2, answer: 0.2, topicLabels: 0.2 },
    timeouts: {
      analysis: 30_000, digest: 60_000, answer: 60_000, classification: 30_000, narrative: 30_000,
      crossRef: 30_000, translation: 30_000, storyline: 30_000, topicLabels: 30_000,
      briefing: 30_000, ideas: 30_000, debate: 30_000, research: 60_000, intel: 20_000, default: 30_000,
    },
  },
  agent: { concurrencyGuardMs: 300_000, phaseTimeoutMs: 30_000, pingTimeoutMs: 5_000 },
  // 分析吞吐：60 篇/轮 × ~8 轮/天 ≈ 480/天（摄入 ~950/天，配合 7 天窗口消化积压；
  // 高价值文章（高分/日报/热门/叙事）优先，长尾文章无摘要是可接受的取舍）
  // subrequestBudget：免费版 50 外部 subrequest/调用是硬上限，analyze 每篇消耗 1~2 次。
  // 给它 20 的预算上限（≈10~20 篇/轮），把剩余额度留给 critical 的日报/叙事——
  // 否则 analyze 独吞预算后 digest/updateNarratives 全部拿不到 subrequest（线上静默失败）。
  analyze: { limitPerRun: 60, subrequestBudget: 20, maxRetries: 3, windowDays: 7, phaseTimeoutMs: 300_000 },
  refine: { batchSize: 10, maxPerRun: 40, phaseTimeoutMs: 30_000 },
  translate: { maxPerRun: 10, phaseTimeoutMs: 30_000 },
  crossRef: { windowDays: 2, minArticles: 4, maxGroups: 5, phaseTimeoutMs: 30_000 },
  // matchThreshold 现在按「覆盖度」解释：叙事 token 集覆盖文章 token 集 ≥0.35 即匹配
  //（此前 jaccard 会被摘要/进展的千级 token 集稀释到不可达，叙事 developments 永远为空）。
  // semanticSampleRate：语义兜底采样比例（15%）；semanticCandidateThreshold：进候选池的最低覆盖度。
  // semanticMatch 是采样里的单次 true/false 判断：给足但不至于拖慢叙事匹配。
  // phaseTimeoutMs=240s：覆盖度匹配修复后一轮可能命中 ~20 个故事，每个进展一次 DeepSeek 串行调用
  //（~6s/个 ≈ 120s），90s 会在途中被阶段超时掐断，只追加一半且每轮报错刷屏。
  narrative: { matchThreshold: 0.35, minClusterSize: 3, staleDays: 7, archiveDays: 14, maxArticles: 100, phaseTimeoutMs: 240_000, semanticMatchTimeoutMs: 10_000, semanticSampleRate: 0.15, semanticCandidateThreshold: 0.2 },
  breaking: { windowHours: 6, maxArticles: 30, minSources: 2, minGroupSize: 2, phaseTimeoutMs: 15_000 },
  entity: { maxArticles: 100, windowHours: 12, similarityThreshold: 0.6, phaseTimeoutMs: 15_000 },
  health: { maxImages: 3, weightDecay: 0.1, weightFloor: 0.1, recoveryStep: 0.15, phaseTimeoutMs: 20_000 },
  // phaseTimeoutMs=200s：给空响应重试留足预算（3 次 ×60s 单次超时 + 退避），否则最坏情况重试没跑完就被掐断
  digest: { maxCandidates: 30, minArticles: 10, minNewArticles: 3, phaseTimeoutMs: 200_000 },
  briefing: { phaseTimeoutMs: 30_000 },
  // 低优先级 AI 阶段的超时要给足（单次调用 30~60s，多处顺序调用），否则被默认 30s 掐断：
  // generateResearchBriefs 最多 5 次 ×60s；前瞻最多 5 次 ×20s；实体事件最多 3 次 ×25s；争议每组 ×30s
  research: { phaseTimeoutMs: 330_000 },
  outlooks: { phaseTimeoutMs: 150_000 },
  entityEvents: { phaseTimeoutMs: 120_000 },
  debate: { phaseTimeoutMs: 90_000 },
  productIdeas: { phaseTimeoutMs: 60_000 },
} as const

/** Resolve phase timeout from config, falling back to agent default. */
export function phaseTimeout(phase: string): number {
  const cfg = (CONFIG as any)[phase]
  return cfg?.phaseTimeoutMs ?? CONFIG.agent.phaseTimeoutMs
}
