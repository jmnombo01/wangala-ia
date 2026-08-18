import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  LuArrowUp,
  LuBookOpen,
  LuCode,
  LuDownload,
  LuCheck,
  LuChevronDown,
  LuCopy,
  LuFileText,
  LuFolderOpen,
  LuGlobe,
  LuImage,
  LuCircleHelp,
  LuLanguages,
  LuMenu,
  LuMessageSquare,
  LuMoon,
  LuEllipsis,
  LuPaperclip,
  LuPanelRight,
  LuRotateCcw,
  LuSearch,
  LuSettings,
  LuShieldCheck,
  LuSparkles,
  LuSquarePen,
  LuSun,
  LuThumbsDown,
  LuThumbsUp,
  LuTerminal,
  LuTrash2,
  LuWifi,
  LuX,
} from 'react-icons/lu'
import BrandMark from './components/BrandMark'
import {
  AgentArtifact,
  AgentTrace,
  ChatMessage,
  isDemoMode,
  sendToAgent,
} from './lib/chatService'

declare global {
  interface Window {
    puter?: { ai: { txt2img: (prompt: string, options?: { model?: string }) => Promise<HTMLImageElement> } }
  }
}

let puterLoader: Promise<void> | null = null
function loadPuter() {
  if (window.puter) return Promise.resolve()
  if (puterLoader) return puterLoader
  puterLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://js.puter.com/v2/'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Puter indisponible'))
    document.head.appendChild(script)
  })
  return puterLoader
}

function isImageGenerationRequest(text: string) {
  return /(?:g[eé]n[eè]re|cr[eé]e|produis|fabrique).{0,60}\b(?:image|illustration|visuel|photo)\b|\b(?:image|illustration|visuel|photo)\b.{0,60}(?:g[eé]n[eè]re|cr[eé]e|produis)/i.test(text)
}

type Attachment = {
  name: string
  size: number
  content?: string
}

type Message = ChatMessage & {
  id: string
  createdAt: number
  trace?: AgentTrace[]
  attachments?: Attachment[]
  artifacts?: AgentArtifact[]
  error?: boolean
}

type Conversation = {
  id: string
  title: string
  messages: Message[]
  updatedAt: number
}

type Capabilities = {
  workspaceConfigured: boolean
  imageGenerationConfigured: boolean
  videoGenerationConfigured: boolean
}

type Suggestion = {
  title: string
  description: string
  prompt: string
  icon: ReactNode
  tone: 'green' | 'gold' | 'red' | 'ink'
}

const STORAGE_KEY = 'wangala-ia-conversations-v1'
const WORKSPACE_DB = 'wangala-ia-workspace-v1'
const WORKSPACE_STORE = 'artifacts'

function openWorkspaceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(WORKSPACE_DB, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(WORKSPACE_STORE)) {
        database.createObjectStore(WORKSPACE_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function persistArtifact(artifact: AgentArtifact) {
  if (!artifact.url?.startsWith('data:')) return
  const database = await openWorkspaceDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(WORKSPACE_STORE, 'readwrite')
    transaction.objectStore(WORKSPACE_STORE).put({ id: artifact.id, url: artifact.url })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

async function restoreArtifactUrl(id: string): Promise<string | undefined> {
  const database = await openWorkspaceDb()
  const result = await new Promise<{ id: string; url: string } | undefined>((resolve, reject) => {
    const request = database.transaction(WORKSPACE_STORE, 'readonly').objectStore(WORKSPACE_STORE).get(id)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  database.close()
  return result?.url
}

const suggestions: Suggestion[] = [
  {
    title: 'Rédiger un courrier',
    description: 'Une lettre claire et professionnelle',
    prompt: 'Aide-moi à rédiger une lettre administrative professionnelle.',
    icon: <LuFileText />,
    tone: 'green',
  },
  {
    title: 'Analyser par le code',
    description: 'Calculer, traiter des données ou tracer un graphique',
    prompt: 'Utilise Python pour calculer les mensualités d’un prêt de 2 000 000 FCFA sur 3 ans à 8 %, puis crée un graphique simple.',
    icon: <LuCode />,
    tone: 'gold',
  },
  {
    title: 'Comprendre un document',
    description: 'Résumer et extraire les points clés',
    prompt: 'Je souhaite résumer un document et identifier ses points clés.',
    icon: <LuBookOpen />,
    tone: 'red',
  },
  {
    title: 'Créer une image',
    description: 'Transformer une idée en visuel original',
    prompt: 'Génère une image carrée : une ville africaine durable et futuriste au coucher du soleil, style éditorial haut de gamme.',
    icon: <LuImage />,
    tone: 'ink',
  },
]

function loadConversations(): Conversation[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored) as Conversation[]
    return parsed.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => {
        const exposesProviderError = message.role === 'assistant'
          && /(rate limit reached|tokens per minute|service tier|console\.groq\.com\/settings\/billing)/i.test(message.content)
        if (!exposesProviderError) return message
        return {
          ...message,
          content: 'Wangala était momentanément très sollicité. Cette erreur technique a été corrigée ; vous pouvez relancer la question.',
          error: true,
        }
      }),
    }))
  } catch {
    return []
  }
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} o`
  return `${Math.ceil(size / 1024)} Ko`
}

async function extractFileText(file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (file.type === 'application/pdf' || extension === 'pdf') {
    const [pdfjsLib, workerModule] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ])
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default
    const document = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    const pages: string[] = []
    const limit = Math.min(document.numPages, 80)
    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const text = await page.getTextContent()
      pages.push(text.items.map((item) => 'str' in item ? item.str : '').join(' '))
    }
    return pages.join('\n\n').slice(0, 100_000)
  }
  if (extension === 'docx' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return result.value.slice(0, 100_000)
  }
  return (await file.text()).slice(0, 100_000)
}

function InlineText({ children }: { children: string }) {
  const parts = children.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s]+)/g)
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index}>{part.slice(2, -2)}</strong>
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={index}>{part.slice(1, -1)}</em>
        }
        const markdownLink = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/)
        if (markdownLink) {
          return <a href={markdownLink[2]} target="_blank" rel="noreferrer" key={index}>{markdownLink[1]}</a>
        }
        if (/^https?:\/\//.test(part)) {
          return <a href={part} target="_blank" rel="noreferrer" key={index}>{part}</a>
        }
        return part
      })}
    </>
  )
}

function RichText({ text }: { text: string }) {
  return (
    <div className="rich-text">
      {text.split('\n').map((line, index) => {
        const numbered = line.match(/^(\d+)\.\s(.+)/)
        const bullet = line.match(/^[-•]\s(.+)/)
        if (!line.trim()) return <div className="text-spacer" key={index} />
        if (numbered) {
          return (
            <div className="list-line" key={index}>
              <span className="list-number">{numbered[1]}</span>
              <p><InlineText>{numbered[2]}</InlineText></p>
            </div>
          )
        }
        if (bullet) {
          return (
            <div className="bullet-line" key={index}>
              <span />
              <p><InlineText>{bullet[1]}</InlineText></p>
            </div>
          )
        }
        return <p key={index}><InlineText>{line}</InlineText></p>
      })}
    </div>
  )
}

function App() {
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isThinking, setIsThinking] = useState(false)
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Record<string, 'up' | 'down'>>({})
  const [notice, setNotice] = useState('')
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const activeConversation = conversations.find((item) => item.id === activeId)
  const messages = activeConversation?.messages ?? []
  const workspaceArtifacts = messages.flatMap((message) => message.artifacts ?? [])

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('fr')
    return conversations
      .filter((item) => !query || item.title.toLocaleLowerCase('fr').includes(query))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [conversations, search])

  useEffect(() => {
    const lightweight = conversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({
        ...message,
        artifacts: message.artifacts?.map((artifact) => ({
          ...artifact,
          url: artifact.url?.startsWith('data:') ? undefined : artifact.url,
        })),
      })),
    }))
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lightweight))
    } catch {
      setNotice('Le stockage local est plein. Téléchargez vos créations importantes.')
    }
  }, [conversations])

  useEffect(() => {
    const missing = conversations.flatMap((conversation) => conversation.messages.flatMap((message) =>
      (message.artifacts ?? []).filter((artifact) => !artifact.url && artifact.type === 'image'),
    ))
    if (!missing.length) return
    void Promise.all(missing.map(async (artifact) => ({ id: artifact.id, url: await restoreArtifactUrl(artifact.id) })))
      .then((restored) => {
        const urls = new Map(restored.filter((item) => item.url).map((item) => [item.id, item.url!]))
        if (!urls.size) return
        setConversations((current) => current.map((conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) => ({
            ...message,
            artifacts: message.artifacts?.map((artifact) => urls.has(artifact.id)
              ? { ...artifact, url: urls.get(artifact.id) }
              : artifact),
          })),
        })))
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isThinking])

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'
  }, [darkMode])

  useEffect(() => {
    if (isDemoMode) return
    void fetch('/api/health')
      .then((response) => response.ok ? response.json() : null)
      .then((health) => health && setCapabilities({
        workspaceConfigured: Boolean(health.workspaceConfigured),
        imageGenerationConfigured: Boolean(health.imageGenerationConfigured),
        videoGenerationConfigured: Boolean(health.videoGenerationConfigured),
      }))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 2800)
    return () => window.clearTimeout(timeout)
  }, [notice])

  function startNewChat() {
    setActiveId(null)
    setInput('')
    setAttachments([])
    setSidebarOpen(false)
    window.setTimeout(() => textAreaRef.current?.focus(), 50)
  }

  function selectConversation(id: string) {
    setActiveId(id)
    setSidebarOpen(false)
  }

  function deleteConversation(id: string) {
    setConversations((current) => current.filter((item) => item.id !== id))
    if (activeId === id) setActiveId(null)
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? [])
    const availableSlots = Math.max(0, 3 - attachments.length)
    const accepted = selectedFiles.slice(0, availableSlots)
    const next: Attachment[] = []

    for (const file of accepted) {
      const supported = /\.(txt|md|csv|json|pdf|docx)$/i.test(file.name) || file.type.startsWith('text/')
      if (!supported) {
        setNotice(`${file.name} n’est pas encore pris en charge. Formats : PDF, DOCX, TXT, MD, CSV et JSON.`)
        continue
      }
      if (file.size > 8_000_000) {
        setNotice(`${file.name} dépasse la limite de 8 Mo.`)
        continue
      }
      try {
        setNotice(`Lecture de ${file.name}…`)
        const content = await extractFileText(file)
        if (!content.trim()) throw new Error('empty')
        next.push({ name: file.name, size: file.size, content })
      } catch {
        setNotice(`Impossible de lire ${file.name}. Le document est peut-être protégé ou numérisé sans texte.`)
      }
    }

    setAttachments((current) => [...current, ...next].slice(0, 3))
    event.target.value = ''
  }

  function removeAttachment(name: string) {
    setAttachments((current) => current.filter((file) => file.name !== name))
  }

  async function sendMessage(rawValue?: string) {
    const visibleContent = (rawValue ?? input).trim() || 'Analyse le document joint.'
    if ((!visibleContent && !attachments.length) || isThinking) return

    const now = Date.now()
    const conversationId = activeId ?? crypto.randomUUID()
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: visibleContent,
      createdAt: now,
      attachments: attachments.map(({ name, size }) => ({ name, size })),
    }
    const previousMessages = activeConversation?.messages ?? []
    const title = visibleContent.length > 42
      ? `${visibleContent.slice(0, 42).trim()}…`
      : visibleContent

    setConversations((current) => {
      const existing = current.find((item) => item.id === conversationId)
      if (existing) {
        return current.map((item) => item.id === conversationId
          ? { ...item, messages: [...item.messages, userMessage], updatedAt: now }
          : item)
      }
      return [{ id: conversationId, title, messages: [userMessage], updatedAt: now }, ...current]
    })
    setActiveId(conversationId)
    setInput('')
    const sentAttachments = attachments
    setAttachments([])
    setIsThinking(true)

    const documentContext = sentAttachments
      .filter((file) => file.content)
      .map((file) => `\n\n--- Fichier : ${file.name} ---\n${file.content}`)
      .join('')
    const apiMessages: ChatMessage[] = [
      ...previousMessages.map(({ role, content }) => ({ role, content })),
      { role: 'user', content: `${visibleContent}${documentContext}` },
    ]

    try {
      if (isImageGenerationRequest(visibleContent)) {
        await loadPuter()
        const image = await window.puter!.ai.txt2img(visibleContent, { model: 'google/imagen-4.0-fast' })
        const artifact: AgentArtifact = {
          id: crypto.randomUUID(), type: 'image', name: 'Image générée', mimeType: 'image/png',
          url: image.src, prompt: visibleContent, createdAt: Date.now(),
        }
        await persistArtifact(artifact).catch(() => undefined)
        const assistantMessage: Message = {
          id: crypto.randomUUID(), role: 'assistant',
          content: 'Image générée et ajoutée à votre Workspace.', createdAt: Date.now(),
          trace: [{ label: 'Image générée', detail: 'Puter · Imagen 4 Fast' }], artifacts: [artifact],
        }
        setConversations((current) => current.map((item) => item.id === conversationId
          ? { ...item, messages: [...item.messages, assistantMessage], updatedAt: Date.now() }
          : item))
        setWorkspaceOpen(true)
        return
      }
      const response = await sendToAgent(apiMessages)
      const generatedArtifacts = response.artifacts ?? []
      void Promise.all(generatedArtifacts.map(persistArtifact)).catch(() => {
        setNotice('Une création n’a pas pu être enregistrée localement.')
      })
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.content,
        createdAt: Date.now(),
        trace: response.trace,
        artifacts: generatedArtifacts,
      }
      if (generatedArtifacts.length) setWorkspaceOpen(true)
      setConversations((current) => current.map((item) => item.id === conversationId
        ? { ...item, messages: [...item.messages, assistantMessage], updatedAt: Date.now() }
        : item))
    } catch (error) {
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: error instanceof Error ? error.message : 'Une erreur inattendue est survenue.',
        createdAt: Date.now(),
        error: true,
      }
      setConversations((current) => current.map((item) => item.id === conversationId
        ? { ...item, messages: [...item.messages, assistantMessage], updatedAt: Date.now() }
        : item))
    } finally {
      setIsThinking(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void sendMessage()
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  async function copyMessage(message: Message) {
    await navigator.clipboard.writeText(message.content)
    setCopiedId(message.id)
    window.setTimeout(() => setCopiedId(null), 1600)
  }

  function downloadArtifact(artifact: AgentArtifact) {
    const anchor = document.createElement('a')
    if (artifact.url) {
      anchor.href = artifact.url
    } else {
      const payload = artifact.type === 'code'
        ? `${artifact.content || ''}\n\n--- Sortie ---\n${artifact.output || ''}`
        : artifact.content || ''
      anchor.href = URL.createObjectURL(new Blob([payload], { type: 'text/plain;charset=utf-8' }))
    }
    const extension = artifact.type === 'image'
      ? artifact.mimeType?.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
      : artifact.language === 'python' ? 'py' : artifact.language === 'javascript' ? 'js' : artifact.language === 'typescript' ? 'ts' : 'txt'
    anchor.download = `${artifact.name.replace(/[^a-zA-Z0-9à-ÿ_-]+/g, '-')}.${extension}`
    anchor.click()
    if (anchor.href.startsWith('blob:')) URL.revokeObjectURL(anchor.href)
  }

  function retryLastMessage() {
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')
    if (lastUserMessage) void sendMessage(lastUserMessage.content)
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-pattern" />
        <div className="sidebar-head">
          <button className="brand" onClick={startNewChat} aria-label="Accueil Wangala IA">
            <BrandMark size={40} />
            <span>
              <strong>Wangala</strong>
              <small>INTELLIGENCE ARTIFICIELLE</small>
            </span>
          </button>
          <button className="sidebar-close icon-button" onClick={() => setSidebarOpen(false)} aria-label="Fermer le menu">
            <LuX />
          </button>
        </div>

        <button className="new-chat" onClick={startNewChat}>
          <LuSquarePen />
          <span>Nouvelle discussion</span>
          <kbd>⌘ K</kbd>
        </button>

        <div className="sidebar-search">
          <LuSearch />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher"
            aria-label="Rechercher une discussion"
          />
        </div>

        <div className="history">
          <div className="history-label">Discussions récentes</div>
          {filteredConversations.length ? (
            filteredConversations.map((conversation) => (
              <div className={`history-item ${conversation.id === activeId ? 'active' : ''}`} key={conversation.id}>
                <button className="history-select" onClick={() => selectConversation(conversation.id)}>
                  <LuMessageSquare />
                  <span>{conversation.title}</span>
                </button>
                <button
                  className="history-delete"
                  onClick={() => deleteConversation(conversation.id)}
                  aria-label={`Supprimer ${conversation.title}`}
                >
                  <LuTrash2 />
                </button>
              </div>
            ))
          ) : (
            <div className="empty-history">
              <LuMessageSquare />
              <p>Vos prochaines discussions apparaîtront ici.</p>
            </div>
          )}
        </div>

        <div className="sidebar-bottom">
          <button className="sidebar-link" onClick={() => setSettingsOpen(true)}>
            <LuSettings /> Réglages
          </button>
          <button className="sidebar-link" onClick={() => setNotice("Le centre d’aide sera disponible prochainement.")}>
            <LuCircleHelp /> Centre d’aide
          </button>
          <button className="profile-card" onClick={() => setSettingsOpen(true)}>
            <span className="avatar">WD</span>
            <span className="profile-copy">
              <strong>Bienvenue</strong>
              <small>{isDemoMode ? 'Espace de démonstration' : 'Agent connecté'}</small>
            </span>
            <LuEllipsis />
          </button>
        </div>
      </aside>

      {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Fermer le panneau latéral" />}

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu icon-button" onClick={() => setSidebarOpen(true)} aria-label="Ouvrir le menu">
              <LuMenu />
            </button>
            <button className="agent-selector">
              <span className="agent-orb"><LuSparkles /></span>
              <span>
                <strong>Wangala Agent</strong>
                <small><i /> Mode agent actif</small>
              </span>
              <LuChevronDown className="selector-chevron" />
            </button>
          </div>
          <div className="topbar-actions">
            <span className="connection"><LuWifi /> Connecté</span>
            <button className={`workspace-button ${workspaceOpen ? 'active' : ''}`} onClick={() => setWorkspaceOpen((current) => !current)}>
              <LuPanelRight /> <span>Workspace</span>{workspaceArtifacts.length > 0 && <b>{workspaceArtifacts.length}</b>}
            </button>
            <button className="language-button"><LuLanguages /> Français</button>
            <button className="icon-button" onClick={() => setDarkMode((current) => !current)} aria-label="Changer de thème">
              {darkMode ? <LuSun /> : <LuMoon />}
            </button>
          </div>
        </header>

        <div className={`workspace ${messages.length ? 'has-messages' : ''}`}>
          {!messages.length ? (
            <section className="welcome">
              <div className="welcome-emblem">
                <div className="sun-rays" />
                <BrandMark size={66} />
              </div>
              <div className="eyebrow"><span /> Votre intelligence, amplifiée <span /></div>
              <h1>Comment puis-je vous aider<br /><em>aujourd’hui&nbsp;?</em></h1>
              <p className="welcome-copy">
                Un agent intelligent qui comprend votre contexte, structure vos idées<br className="desktop-break" />
                et vous accompagne de la réflexion jusqu’à l’action.
              </p>
              <div className="suggestion-grid">
                {suggestions.map((suggestion) => (
                  <button
                    className="suggestion-card"
                    onClick={() => void sendMessage(suggestion.prompt)}
                    key={suggestion.title}
                  >
                    <span className={`suggestion-icon ${suggestion.tone}`}>{suggestion.icon}</span>
                    <span className="suggestion-copy">
                      <strong>{suggestion.title}</strong>
                      <small>{suggestion.description}</small>
                    </span>
                    <LuArrowUp className="suggestion-arrow" />
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className="conversation-view" aria-live="polite">
              <div className="conversation-heading">
                <div>
                  <small>DISCUSSION</small>
                  <h2>{activeConversation?.title}</h2>
                </div>
                <span>{messages.filter((message) => message.role === 'user').length} demande(s)</span>
              </div>

              <div className="messages">
                {messages.map((message) => (
                  <article className={`message ${message.role} ${message.error ? 'message-error' : ''}`} key={message.id}>
                    {message.role === 'assistant' && (
                      <div className="message-avatar"><BrandMark size={32} /></div>
                    )}
                    <div className="message-body">
                      <div className="message-meta">
                        <strong>{message.role === 'assistant' ? 'Wangala Agent' : 'Vous'}</strong>
                        <span>{formatTime(message.createdAt)}</span>
                      </div>
                      {message.attachments?.length ? (
                        <div className="message-files">
                          {message.attachments.map((file) => (
                            <span key={file.name}><LuFileText /> {file.name}</span>
                          ))}
                        </div>
                      ) : null}
                      <div className="message-content"><RichText text={message.content} /></div>
                      {message.artifacts?.length ? (
                        <div className="message-artifacts">
                          {message.artifacts.map((artifact) => (
                            <button className="artifact-inline" key={artifact.id} onClick={() => setWorkspaceOpen(true)}>
                              <span>{artifact.type === 'image' ? <LuImage /> : <LuCode />}</span>
                              <span><strong>{artifact.name}</strong><small>{artifact.type === 'image' ? 'Image' : `Code ${artifact.language || ''}`}</small></span>
                              <LuPanelRight />
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {message.trace?.length ? (
                        <details className="agent-trace">
                          <summary><LuCheck /> Travail de l’agent <span>{message.trace.length} étapes</span></summary>
                          <div className="trace-list">
                            {message.trace.map((trace, index) => (
                              <div key={`${trace.label}-${index}`}>
                                <span>{index + 1}</span>
                                <p><strong>{trace.label}</strong>{trace.detail && <small>{trace.detail}</small>}</p>
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}
                      {message.role === 'assistant' && !message.error && (
                        <div className="message-actions">
                          <button onClick={() => void copyMessage(message)} aria-label="Copier la réponse">
                            {copiedId === message.id ? <LuCheck /> : <LuCopy />}
                          </button>
                          <button
                            className={feedback[message.id] === 'up' ? 'selected' : ''}
                            onClick={() => setFeedback((current) => ({ ...current, [message.id]: 'up' }))}
                            aria-label="Bonne réponse"
                          ><LuThumbsUp /></button>
                          <button
                            className={feedback[message.id] === 'down' ? 'selected' : ''}
                            onClick={() => setFeedback((current) => ({ ...current, [message.id]: 'down' }))}
                            aria-label="Mauvaise réponse"
                          ><LuThumbsDown /></button>
                        </div>
                      )}
                    </div>
                  </article>
                ))}

                {isThinking && (
                  <article className="message assistant thinking-message">
                    <div className="message-avatar"><BrandMark size={32} /></div>
                    <div className="thinking-card">
                      <div className="thinking-dots"><span /><span /><span /></div>
                      <div><strong>Wangala réfléchit…</strong><small>Analyse de votre demande</small></div>
                    </div>
                  </article>
                )}
                <div ref={messagesEndRef} />
              </div>
            </section>
          )}
        </div>

        <div className="composer-zone">
          <form className="composer" onSubmit={submit}>
            {attachments.length > 0 && (
              <div className="attachment-row">
                {attachments.map((file) => (
                  <span className="attachment-pill" key={file.name}>
                    <LuFileText />
                    <span><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span>
                    <button type="button" onClick={() => removeAttachment(file.name)} aria-label={`Retirer ${file.name}`}><LuX /></button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={textAreaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              rows={1}
              placeholder="Écrivez votre demande à Wangala…"
              aria-label="Votre demande"
            />
            <div className="composer-bottom">
              <div className="composer-tools">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".txt,.md,.csv,.json,.pdf,.docx,text/plain,text/csv,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(event) => void handleFiles(event)}
                  hidden
                />
                <button type="button" onClick={() => fileInputRef.current?.click()} title="Ajouter un PDF, Word ou fichier texte">
                  <LuPaperclip /> <span>Joindre</span>
                </button>
                <span className="tool-divider" />
                <span className="agent-mode"><LuGlobe /> Agent Mode</span>
              </div>
              <button className="send-button" type="submit" disabled={isThinking || (!input.trim() && !attachments.length)} aria-label="Envoyer">
                <LuArrowUp />
              </button>
            </div>
          </form>
          <div className="composer-caption">
            <span><LuShieldCheck /> Vos échanges restent confidentiels.</span>
            {messages.length > 0 && <button onClick={retryLastMessage}><LuRotateCcw /> Régénérer</button>}
            <span>Wangala peut faire des erreurs. Vérifiez les informations importantes.</span>
          </div>
        </div>
      </main>

      <aside className={`workspace-panel ${workspaceOpen ? 'workspace-panel-open' : ''}`} aria-hidden={!workspaceOpen}>
        <div className="workspace-panel-head">
          <div>
            <small>ESPACE DE TRAVAIL</small>
            <h2>Workspace</h2>
          </div>
          <button className="icon-button" onClick={() => setWorkspaceOpen(false)} aria-label="Fermer le workspace"><LuX /></button>
        </div>
        <div className="workspace-summary">
          <span><LuFolderOpen /></span>
          <div><strong>{workspaceArtifacts.length} élément{workspaceArtifacts.length > 1 ? 's' : ''}</strong><small>Conservés sur cet appareil</small></div>
        </div>
        <div className="workspace-capabilities">
          <span className={capabilities?.workspaceConfigured ? 'ready' : ''}><LuTerminal /> Code <i /></span>
          <span className={capabilities?.imageGenerationConfigured ? 'ready' : ''}><LuImage /> Images <i /></span>
          <span className={capabilities?.videoGenerationConfigured ? 'ready' : ''}><LuImage /> Vidéo <i /></span>
        </div>
        <div className="workspace-list">
          {workspaceArtifacts.length ? workspaceArtifacts.map((artifact) => (
            <article className="workspace-artifact" key={artifact.id}>
              {artifact.type === 'image' && artifact.url ? (
                <img src={artifact.url} alt={artifact.name} />
              ) : (
                <div className="code-preview">
                  <span><LuTerminal /></span>
                  <pre>{artifact.content || artifact.output || 'Résultat d’exécution'}</pre>
                </div>
              )}
              <div className="workspace-artifact-meta">
                <span className={`artifact-type ${artifact.type}`}>
                  {artifact.type === 'image' ? <LuImage /> : <LuCode />}
                </span>
                <div><strong>{artifact.name}</strong><small>{artifact.type === 'image' ? artifact.mimeType || 'Image' : artifact.language || 'Code'}</small></div>
                <button onClick={() => downloadArtifact(artifact)} aria-label={`Télécharger ${artifact.name}`}><LuDownload /></button>
              </div>
              {artifact.type === 'code' && artifact.output ? <pre className="artifact-output">{artifact.output}</pre> : null}
            </article>
          )) : (
            <div className="workspace-empty">
              <span><LuFolderOpen /></span>
              <h3>Votre espace est vide</h3>
              <p>Demandez à Wangala d’exécuter du code, de créer un graphique ou de générer une image.</p>
              <div><LuCode /> Code <LuImage /> Images</div>
            </div>
          )}
        </div>
      </aside>
      {workspaceOpen && <button className="workspace-scrim" onClick={() => setWorkspaceOpen(false)} aria-label="Fermer le workspace" />}

      {settingsOpen && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Réglages">
          <button className="modal-scrim" onClick={() => setSettingsOpen(false)} aria-label="Fermer les réglages" />
          <div className="settings-panel">
            <div className="settings-head">
              <div><small>WANGALA IA</small><h2>Réglages</h2></div>
              <button className="icon-button" onClick={() => setSettingsOpen(false)}><LuX /></button>
            </div>
            <div className="settings-section">
              <label>Apparence</label>
              <button className="setting-row" onClick={() => setDarkMode((current) => !current)}>
                <span>{darkMode ? <LuMoon /> : <LuSun />} Thème de l’interface</span>
                <strong>{darkMode ? 'Sombre' : 'Clair'}</strong>
              </button>
              <div className="setting-row">
                <span><LuLanguages /> Langue</span>
                <strong>Français</strong>
              </div>
            </div>
            <div className="settings-section">
              <label>État du service</label>
              <div className="status-card">
                <span className={`status-dot ${isDemoMode ? 'demo' : ''}`} />
                <div>
                  <strong>{isDemoMode ? 'Mode démonstration' : 'Modèle IA connecté'}</strong>
                  <p>{isDemoMode
                    ? 'L’interface fonctionne avec des réponses de présentation. Ajoutez la clé API côté serveur pour la production.'
                    : 'Wangala Agent est prêt à traiter vos demandes.'}</p>
                </div>
              </div>
            </div>
            <div className="settings-about">
              <BrandMark size={48} />
              <p><strong>Wangala IA</strong><br />Pensée au Burkina Faso. Utile partout.<br /><small>Version prototype 0.1.0</small></p>
            </div>
          </div>
        </div>
      )}

      {notice && <div className="toast" role="status"><LuCheck /> {notice}</div>}
    </div>
  )
}

export default App
