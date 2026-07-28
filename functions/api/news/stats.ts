import { tryCatch, stats, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  return tryCatch(() => stats(context.env))
}
