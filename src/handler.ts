// Barrel module — re-exports all API functions for endpoint files.
// Endpoints import from this module: import { listNews, json } from '../../../src/handler'

export type { Env } from './helpers.js'

// Common helpers
export { json, requireAdmin, statusCheck, validateAnalysisBody, isoZ, likeEscape, mapNews } from './helpers.js'

// Cache layer
export { cacheGet, cacheSet, cacheDelete, signalEvent, pollEvent, CACHE_TTL } from './cache.js'

// Read-only news feed
export { listNews, trending, categories, stats, search, entitySearch, detail, briefing, sources } from './news-feed.js'

// Topic clustering
export { topics, topic, weekly } from './topics.js'

// News Narrative Agent
export { runAgent, loadActiveNarratives, loadSingleNarrative } from './agent.js'

// Daily digest
export { generateTodayDigest, debugDigest, digest, digests } from './digest.js'

// Admin write endpoints + ask
export { fetchNews, fixImages, translateMissing, saveAnalysis, ask } from './admin.js'
