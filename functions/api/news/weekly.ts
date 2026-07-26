import { weekly, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  return json(await weekly(context.env))
}
