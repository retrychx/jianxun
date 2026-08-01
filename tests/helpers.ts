/**
 * 测试基础设施：真实 SQLite（node:sqlite）+ 逐条应用 migrations/*.sql，
 * 包一个 D1 兼容 shim，供真实 agent phase 函数在测试里运行。
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

export function applyMigrations(db: DatabaseSync): void {
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  for (const f of files) {
    db.exec(readFileSync(join(migrationsDir, f), 'utf8'))
  }
}

/** 把 node:sqlite 包成 D1Database 形状（prepare/bind/all/first/run/batch） */
export function makeD1(db: DatabaseSync): any {
  const prep = (sql: string) => {
    const stmt = db.prepare(sql)
    const exec = (params: any[]) => ({
      all: () => ({ results: stmt.all(...params) as any[], success: true, meta: {} }),
      first: () => (stmt.get(...params) as any) ?? null,
      run: () => {
        const info = stmt.run(...params)
        return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } }
      },
    })
    const noArg = exec([])
    return {
      ...noArg,
      bind: (...params: any[]) => {
        const b = exec(params) as any
        b._run = () => {
          const info = stmt.run(...params)
          return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } }
        }
        return b
      },
    }
  }
  return {
    prepare: prep,
    batch: (stmts: any[]) => stmts.map(s => {
      const info = s._run()
      return { success: true, meta: { changes: info.meta.changes } }
    }),
    exec: (sql: string) => db.exec(sql),
    _db: db,
  }
}

/** 新建内存 DB + D1 shim + 全部迁移 */
export function createTestDB() {
  const db = new DatabaseSync(':memory:')
  applyMigrations(db)
  return { db, d1: makeD1(db) }
}

/** 构造最小 Env */
export function makeEnv(d1: any, apiKey = 'test-key'): any {
  return { DB: d1, DEEPSEEK_API_KEY: apiKey, ADMIN_TOKEN: 'test-admin' }
}
