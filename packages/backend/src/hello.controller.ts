import { Controller, Get } from '@nestjs/common'

interface Message {
  id: number
  text: string
  timestamp: string
}

@Controller()
export class HelloController {
  @Get('hello')
  getHello(): { messages: Message[] } {
    return {
      messages: [
        { id: 1, text: 'Hello from NestJS!', timestamp: new Date().toISOString() },
        { id: 2, text: 'TypeScript 7 with Go backend', timestamp: new Date().toISOString() },
        { id: 3, text: 'Monorepo with pnpm workspaces', timestamp: new Date().toISOString() },
      ],
    }
  }
}
