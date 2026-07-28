import { tryCatch, trending, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  return tryCatch(() => trending(context.env))
}
