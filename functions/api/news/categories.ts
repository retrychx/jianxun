import { categories, json } from '../../../src/handler'

export async function onRequest(context: any) {
  return json(await categories(context.env))
}
