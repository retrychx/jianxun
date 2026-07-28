import { tryCatch, categories, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  return tryCatch(() => categories(context.env))
}
