import { entitySearch, json } from '../../../../src/handler'

export async function onRequestGet(context: any) {
  return json(await entitySearch(context.env, context.params.name))
}
