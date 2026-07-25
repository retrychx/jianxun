import { categories, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  return json(await categories(context.env))
}
