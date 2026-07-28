import { tryCatch, topics, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  return tryCatch(() => topics(context.env))
}
