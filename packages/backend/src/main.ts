import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'

// 加载 .env 文件（如存在）
const envPath = join(import.meta.dirname, '..', '..', '..', '.env')
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    if (key && !process.env[key]) {
      process.env[key] = value
    }
  }
  console.log(`[env] loaded ${envPath}`)
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.setGlobalPrefix('api')
  await app.listen(3000)
  console.log('🚀 Backend running on http://localhost:3000')
}

bootstrap()
