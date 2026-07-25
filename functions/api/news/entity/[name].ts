import { entitySearch, json } from '../../../../src/handler'

export async function onRequest(context: any) {
  return json(await entitySearch(context.env, context.params.name))
}
