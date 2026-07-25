import { briefing, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  return json(await briefing(context.env))
}
