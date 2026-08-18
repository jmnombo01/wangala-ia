export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'wangala-images', model: 'flux-1-schnell' })
    }
    if (request.method !== 'POST' || url.pathname !== '/generate') return new Response('Not found', { status: 404 })
    if (request.headers.get('authorization') !== `Bearer ${env.WANGALA_IMAGE_SECRET}`) return new Response('Unauthorized', { status: 401 })
    let body
    try { body = await request.json() } catch { return new Response('Invalid JSON', { status: 400 }) }
    const prompt = String(body.prompt || '').trim().slice(0, 2048)
    if (!prompt) return new Response('Prompt required', { status: 400 })
    const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt, steps: 4, seed: Math.floor(Math.random() * 2147483647) })
    const binary = Uint8Array.from(atob(result.image), c => c.charCodeAt(0))
    return new Response(binary, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' } })
  }
}
