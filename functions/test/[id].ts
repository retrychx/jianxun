export async function onRequestGet() {
  return new Response('OK: test/[id] works', { headers: { 'Content-Type': 'text/plain' } })
}
