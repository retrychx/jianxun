export async function onRequestGet() {
  return new Response('OK: news id=' + (new URL(globalThis as any as { request: Request }).request?.url || 'unknown'), {
    headers: { 'Content-Type': 'text/plain' }
  })
}
