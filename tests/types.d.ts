// 仅测试用：node:sqlite 的最小类型声明（不引入全局 @types/node，
// 避免与 functions 层的 @cloudflare/workers-types 全局类型冲突）
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string)
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
  export interface StatementSync {
    all(...params: any[]): any[]
    get(...params: any[]): any
    run(...params: any[]): { changes: number; lastInsertRowid: number | bigint }
  }
}
