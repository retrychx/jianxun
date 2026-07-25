import { json } from '../../src/handler'

export async function onRequest() {
  return json({ messages: [{ id: 1, text: 'Hello from 简讯!', timestamp: new Date().toISOString() }] })
}
