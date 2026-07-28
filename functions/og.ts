export async function onRequestGet() {
  return new Response('OK: og works', { headers: { 'Content-Type': 'text/plain' } })
}
