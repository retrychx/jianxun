import { briefing, json } from '../../../src/handler'

export async function onRequest(context: any) {
  return json(await briefing(context.env))
}
