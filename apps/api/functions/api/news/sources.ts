import { tryCatch, sources, json } from '../../../src/handler'

export async function onRequestGet(context: any) {
  return tryCatch(() => sources(context.env))
}
