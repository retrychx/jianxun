import { stats, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  return json(await stats(context.env))
}
