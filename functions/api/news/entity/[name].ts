import { entitySearch, tryCatch } from '../../../../src/handler'

export async function onRequestGet(context: any) {
  return tryCatch(() => entitySearch(context.env, context.params.name))
}
