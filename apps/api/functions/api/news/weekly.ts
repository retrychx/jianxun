import { tryCatch, weekly, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  return tryCatch(() => weekly(context.env))
}
