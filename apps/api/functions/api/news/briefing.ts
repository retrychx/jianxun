import { tryCatch, briefing, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  return tryCatch(() => briefing(context.env))
}
