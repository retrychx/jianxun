import { trending, json } from '../../../src/handler'

export async function onRequest(context: any) {
  return json(await trending(context.env))
}
