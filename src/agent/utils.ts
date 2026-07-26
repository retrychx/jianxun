/** Shared utilities for the News Intelligence Agent phases. */

import type { Env } from '../helpers.js'

/** Per-phase timeout wrapper + structured logging. */
export async function runPhase<T>(
  name: string,
  fn: () => Promise<T>,
  timeoutMs = 30_000,
): Promise<{ ok: boolean; result?: T; error?: string; ms: number }> {
  const start = Date.now()
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ])
    const ms = Date.now() - start
    console.log(`[agent] ${name} ok ${ms}ms`)
    return { ok: true, result, ms }
  } catch (err: any) {
    const ms = Date.now() - start
    const msg = err?.message || err?.toString() || 'unknown error'
    console.error(`[agent] ${name} FAIL ${ms}ms: ${msg.slice(0, 200)}`)
    return { ok: false, error: msg.slice(0, 200), ms }
  }
}

/** Ping DeepSeek with a minimal request to verify the API is responsive. */
export async function pingDeepSeek(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.deepseek.com/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5_000),
    })
    return res.ok
  } catch {
    console.error('[agent] DeepSeek ping failed — skipping AI phases')
    return false
  }
}

/** Get/set agent last-run timestamp from agent_meta. */
export async function getLastAgentRun(env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM agent_meta WHERE key = 'last_run'").first<any>()
  return row?.value || new Date(Date.now() - 86_400_000).toISOString()
}

export async function setLastAgentRun(env: Env): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO agent_meta (key, value) VALUES ('last_run', ?)")
    .bind(new Date().toISOString()).run()
}
