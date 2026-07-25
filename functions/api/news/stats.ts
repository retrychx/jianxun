import { stats, json } from '../../../src/handler'

export async function onRequest(context: any) {
  return json(await stats(context.env))
}
