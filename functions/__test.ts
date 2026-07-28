export async function onRequestGet() {
  return new Response('hello from test function', { headers: { 'Content-Type': 'text/plain' } })
}
