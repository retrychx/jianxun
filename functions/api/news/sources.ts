import { sources, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  return json(await sources(context.env))
}
