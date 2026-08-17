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
const SEARCH_MODEL = process.env.SEARCH_MODEL || 'groq/compound-mini'
const FALLBACK_MODELS = (process.env.LLM_FALLBACK_MODELS || 'openai/gpt-oss-120b,qwen/qwen3.6-27b')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean)
const SEARCH_FALLBACK_MODELS = (process.env.SEARCH_FALLBACK_MODELS || 'groq/compound')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean)
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || ''
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || ''
const MAX_BODY_BYTES = 1_000_000
const MAX_CONTEXT_CHARS = Number(process.env.MAX_CONTEXT_CHARS || 14_000)
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 1_200)
const MAX_REQUESTS_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE || 30)
const PROVIDER_RETRIES = Number(process.env.PROVIDER_RETRIES || 1)
const rateLimits = new Map()

const currentDate = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'full',
  timeZone: 'Africa/Ouagadougou',
}).format(new Date())

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || `Tu es Wangala Agent, un assistant IA francophone fiable, méthodique, utile et orienté vers l'action. Nous sommes le ${currentDate}, fuseau Africa/Ouagadougou. Réponds d'abord en français, sauf demande contraire. Tiens compte avec respect du contexte du Burkina Faso et de l'Afrique de l'Ouest lorsque c'est pertinent, sans stéréotype ni supposition. Réponds directement à toute demande légale et sûre : ne refuse pas une question simplement parce qu'elle implique une estimation, une comparaison, un pari ou une incertitude. Pour les courses hippiques et autres jeux d'argent, tu peux fournir une analyse factuelle, les partants, la forme et des scénarios, mais ne garantis jamais un gain et rappelle brièvement que le résultat reste incertain et qu'il faut limiter sa mise. Pour la santé, le droit, la finance et la sécurité, donne des informations utiles tout en recommandant une vérification professionnelle lorsque l'enjeu est important. Si tu utilises une recherche, cite les sources ou liens disponibles. N'invente jamais une donnée, une source, une action ou une recherche.`

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

class ProviderError extends Error {
  constructor(code, status, model) {
    super(code)
    this.name = 'ProviderError'
    this.code = code
    this.status = status
    this.model = model
  }
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

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
  const cleaned = input
    .slice(-16)
    .filter((message) => message && ['user', 'assistant'].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').trim().slice(0, MAX_CONTEXT_CHARS),
    }))
    .filter((message) => message.content)

  const selected = []
  let remaining = MAX_CONTEXT_CHARS
  for (let index = cleaned.length - 1; index >= 0 && selected.length < 12; index -= 1) {
    const message = cleaned[index]
    if (remaining <= 0) break
    const content = message.content.slice(-remaining)
    if (!content) continue
    selected.unshift({ ...message, content })
    remaining -= content.length
  }
  return selected
}

function needsFreshInformation(messages) {
  const latest = [...messages].reverse().find((message) => message.role === 'user')?.content || ''
  return /(aujourd['’]?hui|du jour|maintenant|actuel(?:le)?s?|récent(?:e)?s?|derni[eè]re?s?|nouveau|nouvelles|actualité|météo|prix|tarif|cours|score|résultat|calendrier|disponib|quint[ée]|pmu|course hippique|pronostic|élection|marché|bourse|taux de change|202[5-9])/i.test(latest)
}

function extractRetrySeconds(response, body) {
  const header = Number(response.headers.get('retry-after'))
  if (Number.isFinite(header) && header > 0) return Math.min(header, 25)
  const message = body?.error?.message || ''
  const match = message.match(/try again in\s+([\d.]+)s/i)
  return match ? Math.min(Math.ceil(Number(match[1])) + 1, 25) : 8
}

function extractContent(message) {
  if (typeof message?.content === 'string') return message.content.trim()
  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => typeof part === 'string' ? part : part?.text || '')
      .join('\n')
      .trim()
  }
  return ''
}

async function requestModel(model, messages, tools = [], forceBuiltInSearch = false) {
  for (let attempt = 0; attempt <= PROVIDER_RETRIES; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 100_000)
    try {
      const useGroqBuiltInSearch = forceBuiltInSearch && model.startsWith('groq/compound')
      const payload = {
        model,
        messages,
        temperature: 0.35,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
        ...(useGroqBuiltInSearch ? {
          compound_custom: {
            tools: { enabled_tools: ['web_search', 'visit_website'] },
          },
        } : {}),
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
      if (response.ok) {
        const message = body?.choices?.[0]?.message
        if (!message) throw new ProviderError('EMPTY_RESPONSE', 502, model)
        return message
      }

      const diagnostic = String(body?.error?.message || `HTTP ${response.status}`)
        .replace(/org_[a-zA-Z0-9]+/g, 'org_***')
        .replace(/https?:\/\/\S+/g, '[url]')
        .replace(/(bearer|api[_ -]?key|token)\s*[:=]?\s*[a-zA-Z0-9._-]+/gi, '$1 ***')
        .slice(0, 280)
      console.warn(`[wangala-provider] ${model} HTTP ${response.status}: ${diagnostic}`)

      if (response.status === 429 && attempt < PROVIDER_RETRIES) {
        await wait(extractRetrySeconds(response, body) * 1_000)
        continue
      }
      if (response.status === 429) throw new ProviderError('RATE_LIMIT', 429, model)
      if (response.status === 401 || response.status === 403) throw new ProviderError('AUTH_ERROR', response.status, model)
      if (response.status === 404 || /does not exist|do not have access/i.test(body?.error?.message || '')) {
        throw new ProviderError('MODEL_UNAVAILABLE', response.status, model)
      }
      throw new ProviderError('PROVIDER_ERROR', response.status, model)
    } catch (error) {
      if (error instanceof ProviderError) throw error
      if (error?.name === 'AbortError') throw new ProviderError('TIMEOUT', 504, model)
      throw new ProviderError('NETWORK_ERROR', 502, model)
    } finally {
      clearTimeout(timeout)
    }
  }
  throw new ProviderError('RATE_LIMIT', 429, model)
}

async function webSearch(query) {
  if (!TAVILY_API_KEY) return { error: 'La recherche web externe n’est pas configurée.' }
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
  if (!response.ok) return { error: 'La recherche externe est momentanément indisponible.' }
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

async function runWithModel(userMessages, model, useBuiltInSearch = false) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...userMessages]
  const trace = [{ label: 'Demande analysée', detail: 'Contexte et objectif identifiés' }]

  if (useBuiltInSearch) {
    const modelMessage = await requestModel(model, messages, [], true)
    const content = extractContent(modelMessage)
    if (!content) throw new ProviderError('EMPTY_RESPONSE', 502, model)
    const executedTools = Array.isArray(modelMessage.executed_tools) ? modelMessage.executed_tools : []
    if (!executedTools.length) throw new ProviderError('SEARCH_NOT_USED', 502, model)
    trace.push({
      label: 'Recherche web effectuée',
      detail: `${executedTools.length} outil${executedTools.length > 1 ? 's' : ''} utilisé${executedTools.length > 1 ? 's' : ''}`,
    })
    trace.push({ label: 'Réponse vérifiée', detail: 'Informations récentes et sources intégrées' })
    return { content, trace }
  }

  for (let step = 0; step < 3; step += 1) {
    const modelMessage = await requestModel(model, messages, agentTools)
    const toolCalls = Array.isArray(modelMessage.tool_calls) ? modelMessage.tool_calls : []
    const content = extractContent(modelMessage)

    if (!toolCalls.length) {
      if (!content) throw new ProviderError('EMPTY_RESPONSE', 502, model)
      trace.push({ label: 'Réponse préparée', detail: step ? 'Résultats des outils intégrés' : 'Analyse finalisée' })
      return { content, trace }
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
        content: JSON.stringify(result).slice(0, 30_000),
      })
    }
  }

  throw new ProviderError('TOOL_LIMIT', 502, model)
}

async function runAgent(userMessages) {
  const freshInformation = needsFreshInformation(userMessages)
  const candidates = (freshInformation
    ? [
        { model: SEARCH_MODEL, search: true },
        ...SEARCH_FALLBACK_MODELS.map((model) => ({ model, search: true })),
      ]
    : [
        { model: LLM_MODEL, search: false },
        ...FALLBACK_MODELS.map((model) => ({ model, search: false })),
      ])
    .filter((candidate, index, all) => candidate.model && all.findIndex((item) => item.model === candidate.model) === index)

  let lastError = null
  for (const candidate of candidates) {
    try {
      return await runWithModel(userMessages, candidate.model, candidate.search)
    } catch (error) {
      lastError = error
      if (!(error instanceof ProviderError)) throw error
      console.warn(`[wangala-api] modèle ${candidate.model} indisponible (${error.code}), bascule automatique`)
    }
  }
  throw lastError || new ProviderError('PROVIDER_ERROR', 502, LLM_MODEL)
}

function friendlyError(error) {
  if (!(error instanceof ProviderError)) return { status: 502, message: 'Wangala rencontre un problème temporaire. Réessayez dans quelques instants.' }
  if (error.code === 'RATE_LIMIT') {
    return { status: 429, message: 'Wangala est très sollicité. Patientez une vingtaine de secondes puis réessayez.' }
  }
  if (error.code === 'AUTH_ERROR') {
    return { status: 503, message: 'Le service IA doit être reconnecté par l’administrateur.' }
  }
  if (error.code === 'TIMEOUT') {
    return { status: 504, message: 'La réponse prend plus de temps que prévu. Réessayez avec une demande plus courte.' }
  }
  return { status: 502, message: 'Wangala n’a pas pu finaliser cette réponse. Réessayez dans quelques instants.' }
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
      release: '0.2.2',
      modelConfigured: Boolean(LLM_API_KEY && LLM_MODEL),
      webSearchConfigured: Boolean(LLM_API_KEY && (SEARCH_MODEL || TAVILY_API_KEY)),
      automaticFallbacks: FALLBACK_MODELS.length,
      searchFallbacks: SEARCH_FALLBACK_MODELS.length,
    }, cors)
  }

  if (url.pathname === '/api/chat' && request.method === 'POST') {
    if (ALLOWED_ORIGIN && request.headers.origin && request.headers.origin !== ALLOWED_ORIGIN) {
      return sendJson(response, 403, { error: 'Origine non autorisée.' }, cors)
    }
    if (isRateLimited(request)) {
      return sendJson(response, 429, { error: 'Trop de demandes simultanées. Réessayez dans une minute.' }, cors)
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
      console.error('[wangala-api]', error?.code || error?.message || error)
      const friendly = friendlyError(error)
      return sendJson(response, friendly.status, { error: friendly.message }, cors)
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
