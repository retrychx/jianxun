import { tryCatch, statusCheck, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  return tryCatch(() => statusCheck(context.env))
}
