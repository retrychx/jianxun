import { topics, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  return json(await topics(context.env))
}
