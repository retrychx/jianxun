import { tryCatch, digests, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  return tryCatch(() => digests(context.env))
}
