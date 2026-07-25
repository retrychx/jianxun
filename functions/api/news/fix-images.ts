import { fixImages, json } from '../../../src/handler'

export async function onRequest(context: any) {
  return json(await fixImages(context.env))
}
