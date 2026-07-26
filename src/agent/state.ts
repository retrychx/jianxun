/**
 * Agent state management — last-run tracking, execution log persistence,
 * and circuit breaker (DeepSeek availability check).
 */

import type { Env } from '../helpers.js'
import type { AgentRunLog } from './types.js'
import { CONFIG } from './config.js'

const META_LAST_RUN = 'last_run'
const META_LAST_LOG = 'last_log'

/** Check if a minimum interval has passed since the last agent run. */
export async function shouldSkipDueToConcurrency(env: Env): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT value FROM agent_meta WHERE key = '${META_LAST_RUN}'`).first<any>()
  if (!row?.value) return false
  return (Date.now() - new Date(row.value).getTime()) < CONFIG.agent.concurrencyGuardMs
}

/** Persist the current timestamp as the last agent run. */
export async function markAgentRun(env: Env): Promise<void> {
  await env.DB.prepare(`INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('${META_LAST_RUN}', ?)`)
    .bind(new Date().toISOString()).run()
}

/** Save a structured agent run log. */
export async function saveAgentLog(env: Env, log: AgentRunLog): Promise<void> {
  await env.DB.prepare(`INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('${META_LAST_LOG}', ?)`)
    .bind(JSON.stringify(log)).run()
}

/** Ping DeepSeek to verify the API is responsive (circuit breaker). */
export async function pingDeepSeek(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.deepseek.com/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(CONFIG.agent.pingTimeoutMs),
    })
    return res.ok
  } catch {
    console.error('[agent] DeepSeek ping failed — skipping AI phases')
    return false
  }
}
