import { trending, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  return json(await trending(context.env))
}
