import { topics, json } from '../../../src/handler'

export async function onRequest(context: any) {
  return json(await topics(context.env))
}
