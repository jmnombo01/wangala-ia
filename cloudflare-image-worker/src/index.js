export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'wangala-images', model: 'flux-1-schnell' })
    }
    if (request.method !== 'POST' || !['/generate', '/analyze'].includes(url.pathname)) return new Response('Not found', { status: 404 })
    if (request.headers.get('authorization') !== `Bearer ${env.WANGALA_IMAGE_SECRET}`) return new Response('Unauthorized', { status: 401 })
    let body
    try { body = await request.json() } catch { return new Response('Invalid JSON', { status: 400 }) }
    if (url.pathname === '/analyze') {
      const image = String(body.image || '')
      if (!image.startsWith('data:image/') || image.length > 4_000_000) return new Response('Invalid image', { status: 400 })
      const result = await env.AI.run('@cf/moondream/moondream3.1-9B-A2B', { task: 'query', image, question: String(body.question || 'Décris précisément cette image en français, lis le texte visible et relève les informations importantes.'), stream: false, reasoning: true, max_tokens: 2048 })
      return Response.json({ description: result.answer || result.caption || '' })
    }
    const prompt = String(body.prompt || '').trim().slice(0, 2048)
    if (!prompt) return new Response('Prompt required', { status: 400 })
    const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt, steps: 4 })
    const binary = Uint8Array.from(atob(result.image), c => c.charCodeAt(0))
    return new Response(binary, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' } })
  }
}
