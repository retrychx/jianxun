import { pollEvent } from '../../src/cache'

// SSE endpoint: pushes real-time events to the frontend.
// Polls the Cache API every 10s for new-article fetch events.
// After a fetch completes, the admin endpoint writes an event via signalEvent()
// and connected SSE clients receive a `new-articles` event.

export async function onRequestGet(context: any) {
  const { request } = context

  let lastEventTs = 0

  const encoder = new TextEncoder()
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  let closed = false

  // Helper to write an SSE message safely
  function send(event: string, data: any) {
    if (closed) return
    writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => { closed = true })
  }

  // Send an initial connected event
  send('connected', { timestamp: Date.now() })

  // Heartbeat every 30s to keep the connection alive
  const heartbeat = setInterval(() => {
    send('heartbeat', {})
  }, 30_000)

  // Poll for fetch + breaking events every 10s
  const pollTimer = setInterval(async () => {
    try {
      const [fetchEvt, breakingEvt] = await Promise.all([
        pollEvent<{ count: number; timestamp: string }>('fetch', lastEventTs),
        pollEvent<{ title: string; sources: string[]; significance: string }>('breaking', lastEventTs),
      ])
      if (fetchEvt) {
        lastEventTs = fetchEvt.ts
        send('new-articles', fetchEvt.data)
      }
      if (breakingEvt) {
        lastEventTs = breakingEvt.ts
        send('breaking', breakingEvt.data)
      }
    } catch { /* best-effort polling */ }
  }, 10_000)

  // On disconnect, clean up timers and close the stream
  request.signal.addEventListener('abort', () => {
    closed = true
    clearInterval(heartbeat)
    clearInterval(pollTimer)
    writer.close().catch(() => {})
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
