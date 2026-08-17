import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '0.0.0.0'
const STATIC_DIR = process.env.STATIC_DIR || fileURLToPath(new URL('../frontend/dist', import.meta.url))
const LLM_API_URL = (process.env.LLM_API_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
const LLM_API_KEY = process.env.LLM_API_KEY || ''
const LLM_MODEL = process.env.LLM_MODEL || ''
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || ''
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || ''
const MAX_BODY_BYTES = 1_000_000
const MAX_REQUESTS_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE || 30)
const rateLimits = new Map()

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || `Tu es Wangala Agent, un assistant IA francophone fiable, méthodique et orienté vers l'action. Tu réponds d'abord en français, sauf demande contraire. Tu tiens compte avec respect du contexte du Burkina Faso et de l'Afrique de l'Ouest lorsque cela est pertinent, sans stéréotype ni supposition. Tu structures clairement tes réponses, signales tes incertitudes et ne prétends jamais avoir effectué une action ou une recherche que tu n'as pas réalisée. Pour les sujets importants (santé, droit, finance, sécurité), rappelle à l'utilisateur de vérifier auprès d'une source qualifiée.`

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function corsHeaders(request) {
  const origin = request.headers.origin || ''
  const allowOrigin = ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN
    ? ALLOWED_ORIGIN
    : ALLOWED_ORIGIN
      ? ''
      : origin
  return {
    ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Vary': 'Origin',
  }
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  response.end(JSON.stringify(payload))
}

function clientIp(request) {
  return String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'unknown')
    .split(',')[0]
    .trim()
}

function isRateLimited(request) {
  const key = clientIp(request)
  const now = Date.now()
  const bucket = rateLimits.get(key)
  if (!bucket || bucket.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + 60_000 })
    return false
  }
  bucket.count += 1
  return bucket.count > MAX_REQUESTS_PER_MINUTE
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('INVALID_JSON')
  }
}

function sanitizeMessages(input) {
  if (!Array.isArray(input)) return []
  return input
    .slice(-30)
    .filter((message) => message && ['user', 'assistant'].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').slice(0, 120_000),
    }))
    .filter((message) => message.content.trim())
}

async function callModel(messages, tools) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90_000)
  try {
    const payload = {
      model: LLM_MODEL,
      messages,
      temperature: 0.3,
      ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
    }
    const response = await fetch(`${LLM_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      const providerMessage = body?.error?.message || `Erreur du fournisseur (${response.status})`
      throw new Error(providerMessage)
    }
    const message = body?.choices?.[0]?.message
    if (!message) throw new Error("Le fournisseur n'a renvoyé aucune réponse exploitable.")
    return message
  } finally {
    clearTimeout(timeout)
  }
}

async function webSearch(query) {
  if (!TAVILY_API_KEY) return { error: 'La recherche web n’est pas configurée.' }
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query: String(query || '').slice(0, 400),
      search_depth: 'advanced',
      max_results: 6,
      include_answer: true,
    }),
  })
  if (!response.ok) return { error: `Recherche indisponible (${response.status}).` }
  const body = await response.json()
  return {
    answer: body.answer,
    results: (body.results || []).map(({ title, url, content }) => ({ title, url, content })),
  }
}

const agentTools = [
  {
    type: 'function',
    function: {
      name: 'current_datetime',
      description: 'Obtenir la date et l’heure actuelles pour le fuseau horaire du Burkina Faso.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  ...(TAVILY_API_KEY ? [{
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Rechercher des informations récentes et vérifiables sur le web.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Requête de recherche précise' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  }] : []),
]

async function executeTool(name, args) {
  if (name === 'current_datetime') {
    return {
      timezone: 'Africa/Ouagadougou',
      value: new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'full',
        timeStyle: 'long',
        timeZone: 'Africa/Ouagadougou',
      }).format(new Date()),
    }
  }
  if (name === 'web_search') return webSearch(args.query)
  return { error: `Outil inconnu : ${name}` }
}

async function runAgent(userMessages) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...userMessages]
  const trace = [{ label: 'Demande analysée', detail: 'Contexte et objectif identifiés' }]

  for (let step = 0; step < 4; step += 1) {
    const modelMessage = await callModel(messages, agentTools)
    const toolCalls = Array.isArray(modelMessage.tool_calls) ? modelMessage.tool_calls : []

    if (!toolCalls.length) {
      trace.push({ label: 'Réponse préparée', detail: step ? 'Résultats des outils intégrés' : 'Raisonnement finalisé' })
      return {
        content: String(modelMessage.content || 'Je ne peux pas répondre pour le moment.'),
        trace,
      }
    }

    messages.push(modelMessage)
    for (const toolCall of toolCalls) {
      let args = {}
      try { args = JSON.parse(toolCall.function?.arguments || '{}') } catch { args = {} }
      const name = toolCall.function?.name || 'outil'
      trace.push({
        label: name === 'web_search' ? 'Recherche web effectuée' : 'Date actuelle vérifiée',
        detail: name === 'web_search' ? String(args.query || '').slice(0, 90) : 'Africa/Ouagadougou',
      })
      const result = await executeTool(name, args)
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result).slice(0, 60_000),
      })
    }
  }

  throw new Error("L’agent a atteint sa limite d’étapes. Reformulez votre demande.")
}

async function serveStatic(request, response) {
  const requestPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname)
  const safePath = normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, '')
  let filePath = join(STATIC_DIR, safePath === '/' ? 'index.html' : safePath)

  try {
    const fileStat = await stat(filePath)
    if (fileStat.isDirectory()) filePath = join(filePath, 'index.html')
  } catch {
    filePath = join(STATIC_DIR, 'index.html')
  }

  try {
    const data = await readFile(filePath)
    const extension = extname(filePath).toLowerCase()
    response.writeHead(200, {
      'Content-Type': mimeTypes[extension] || 'application/octet-stream',
      'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    })
    response.end(data)
  } catch {
    sendJson(response, 404, { error: 'Ressource introuvable.' })
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`)
  const cors = corsHeaders(request)

  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors)
    return response.end()
  }

  if (url.pathname === '/api/health' && request.method === 'GET') {
    return sendJson(response, 200, {
      status: 'ok',
      service: 'wangala-ia',
      modelConfigured: Boolean(LLM_API_KEY && LLM_MODEL),
      webSearchConfigured: Boolean(TAVILY_API_KEY),
    }, cors)
  }

  if (url.pathname === '/api/chat' && request.method === 'POST') {
    if (ALLOWED_ORIGIN && request.headers.origin && request.headers.origin !== ALLOWED_ORIGIN) {
      return sendJson(response, 403, { error: 'Origine non autorisée.' }, cors)
    }
    if (isRateLimited(request)) {
      return sendJson(response, 429, { error: 'Trop de demandes. Réessayez dans une minute.' }, cors)
    }
    if (!LLM_API_KEY || !LLM_MODEL) {
      return sendJson(response, 503, { error: 'Le modèle IA n’est pas encore configuré sur le serveur.' }, cors)
    }

    try {
      const body = await readJsonBody(request)
      const messages = sanitizeMessages(body.messages)
      if (!messages.length || messages.at(-1)?.role !== 'user') {
        return sendJson(response, 400, { error: 'Ajoutez au moins un message utilisateur.' }, cors)
      }
      const result = await runAgent(messages)
      return sendJson(response, 200, result, cors)
    } catch (error) {
      if (error?.message === 'PAYLOAD_TOO_LARGE') {
        return sendJson(response, 413, { error: 'La demande est trop volumineuse.' }, cors)
      }
      if (error?.message === 'INVALID_JSON') {
        return sendJson(response, 400, { error: 'Le format de la demande est invalide.' }, cors)
      }
      console.error('[wangala-api]', error)
      return sendJson(response, 502, { error: error?.message || 'Erreur du service IA.' }, cors)
    }
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    return serveStatic(request, response)
  }

  return sendJson(response, 404, { error: 'Route introuvable.' }, cors)
})

server.listen(PORT, HOST, () => {
  console.log(`Wangala IA écoute sur http://${HOST}:${PORT}`)
})
