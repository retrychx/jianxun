/**
 * Centralized agent configuration — all thresholds, limits, model names,
 * and phase settings in one place.  Import CONFIG from any agent file.
 */

export const CONFIG = {
  deepseek: {
    model: 'deepseek-v4-flash',
    temperature: { analysis: 0.3, classification: 0.05, digest: 0.2, narrative: 0.2, translation: 0.1, storyline: 0.2, crossRef: 0.2, answer: 0.2, topicLabels: 0.2 },
    timeouts: { analysis: 30_000, digest: 60_000, answer: 60_000, classification: 30_000, narrative: 30_000, crossRef: 30_000, translation: 30_000, storyline: 30_000, topicLabels: 30_000, default: 30_000 },
  },
  agent: { concurrencyGuardMs: 300_000, phaseTimeoutMs: 30_000, pingTimeoutMs: 5_000 },
  analyze: { limitPerRun: 10, maxRetries: 3, windowDays: 2, phaseTimeoutMs: 90_000 },
  refine: { batchSize: 10, maxPerRun: 40, phaseTimeoutMs: 30_000 },
  translate: { maxPerRun: 10, phaseTimeoutMs: 30_000 },
  crossRef: { windowDays: 2, minArticles: 4, maxGroups: 5, phaseTimeoutMs: 30_000 },
  narrative: { matchThreshold: 0.35, minClusterSize: 3, staleDays: 7, archiveDays: 14, maxArticles: 100, phaseTimeoutMs: 60_000 },
  breaking: { windowHours: 6, maxArticles: 30, minSources: 2, minGroupSize: 2, phaseTimeoutMs: 15_000 },
  entity: { maxArticles: 100, windowHours: 12, similarityThreshold: 0.6, phaseTimeoutMs: 15_000 },
  health: { maxImages: 3, weightDecay: 0.1, weightFloor: 0.1, recoveryStep: 0.15, phaseTimeoutMs: 10_000 },
  digest: { maxCandidates: 30, minArticles: 10, minNewArticles: 3, phaseTimeoutMs: 30_000 },
  briefing: { phaseTimeoutMs: 30_000 },
} as const

/** Resolve phase timeout from config, falling back to agent default. */
export function phaseTimeout(phase: string): number {
  const cfg = (CONFIG as any)[phase]
  return cfg?.phaseTimeoutMs ?? CONFIG.agent.phaseTimeoutMs
}
