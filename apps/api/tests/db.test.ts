/**
 * 轻量数据访问层（src/db.ts）单测：
 * agent_meta 键常量 + metaGet/metaSet/metaGetJSON/metaSetJSON/metaDelete。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDB, makeEnv } from './helpers'
import { META, metaGet, metaSet, metaGetJSON, metaSetJSON, metaDelete } from '../src/db.js'

let env: any

beforeEach(() => {
  const { d1 } = createTestDB()
  env = makeEnv(d1)
})

describe('agent_meta 访问层', () => {
  it('metaSet/metaGet 原始字符串往返；缺失返回 null', async () => {
    await metaSet(env, META.lastRun, '2026-08-08T00:00:00.000Z')
    expect(await metaGet(env, META.lastRun)).toBe('2026-08-08T00:00:00.000Z')
    expect(await metaGet(env, 'not_exists')).toBeNull()
  })

  it('metaSetJSON/metaGetJSON 对象往返', async () => {
    const log = { ts: '2026-08-08T00:00:00Z', results: { analyzeNewArticles: { ok: true, ms: 100 } } }
    await metaSetJSON(env, META.lastLog, log)
    expect(await metaGetJSON(env, META.lastLog)).toEqual(log)
  })

  it('metaGetJSON 遇坏 JSON 返回 null 而非抛错', async () => {
    await metaSet(env, META.agentReport, '{broken json')
    expect(await metaGetJSON(env, META.agentReport)).toBeNull()
  })

  it('metaGetJSON 缺失返回 null', async () => {
    expect(await metaGetJSON(env, META.agentKpis)).toBeNull()
  })

  it('metaSet 覆盖已有键（INSERT OR REPLACE 语义）', async () => {
    await metaSet(env, META.lastRun, 'a')
    await metaSet(env, META.lastRun, 'b')
    expect(await metaGet(env, META.lastRun)).toBe('b')
  })

  it('metaDelete 删除键', async () => {
    await metaSet(env, META.running, '123')
    await metaDelete(env, META.running)
    expect(await metaGet(env, META.running)).toBeNull()
  })

  it('META 键常量全为合法字符串且不重复', () => {
    const values = Object.values(META)
    expect(new Set(values).size).toBe(values.length)
    for (const v of values) expect(typeof v).toBe('string')
  })
})
