import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // root 指向本目录，使 include 的 tests/** 解析到 apps/api/tests（cwd 是仓库根）
    root: new URL('.', import.meta.url).pathname,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
