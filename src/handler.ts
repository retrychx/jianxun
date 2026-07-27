// Barrel module — re-exports all API functions for endpoint files.
// Endpoints import from this module: import { listNews, json } from '../../../src/handler'

export type { Env } from './helpers.js'

// Common helpers
export { json, requireAdmin, statusCheck, validateAnalysisBody, isoZ, likeEscape, mapNews } from './helpers.js'

// Cache layer
export { cacheGet, cacheSet, cacheDelete, signalEvent, pollEvent, CACHE_TTL } from './cache.js'

// Read-only news feed
export { listNews, trending, categories, stats, search, entitySearch, detail, briefing, sources } from './api/read.js'

// Topic clustering
export { topics, topic, weekly } from './topics.js'

// News Intelligence Agent (unified AI pipeline)
export { runAgent, fixMissingImages as fixImages, fixMissingImages, analyzeNewArticles, refineCategories, translateMissing, runCrossRefAnalysis, detectBreakingNews, linkEntities, tuneSourceWeights, curateBriefing, detectControversy, loadActiveNarratives, loadSingleNarrative } from './agent/index.js'

// Daily digest
export { generateTodayDigest, debugDigest, digest, digests } from './api/digest.js'

// Admin write endpoints + ask (agent phase functions exported from agent.ts)
export { fetchNews, saveAnalysis, ask } from './api/write.js'
