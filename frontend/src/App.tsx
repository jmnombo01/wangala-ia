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
  LuBriefcaseBusiness,
  LuCheck,
  LuChevronDown,
  LuCopy,
  LuFileText,
  LuGlobe,
  LuCircleHelp,
  LuLanguages,
  LuMenu,
  LuMessageSquare,
  LuMoon,
  LuEllipsis,
  LuPaperclip,
  LuRotateCcw,
  LuSearch,
  LuSettings,
  LuShieldCheck,
  LuSparkles,
  LuSquarePen,
  LuSun,
  LuThumbsDown,
  LuThumbsUp,
  LuTrash2,
  LuWifi,
  LuX,
} from 'react-icons/lu'
import BrandMark from './components/BrandMark'
import {
  AgentTrace,
  ChatMessage,
  isDemoMode,
  sendToAgent,
} from './lib/chatService'

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
  error?: boolean
}

type Conversation = {
  id: string
  title: string
  messages: Message[]
  updatedAt: number
}

type Suggestion = {
  title: string
  description: string
  prompt: string
  icon: ReactNode
  tone: 'green' | 'gold' | 'red' | 'ink'
}

const STORAGE_KEY = 'wangala-ia-conversations-v1'

const suggestions: Suggestion[] = [
  {
    title: 'Rédiger un courrier',
    description: 'Une lettre claire et professionnelle',
    prompt: 'Aide-moi à rédiger une lettre administrative professionnelle.',
    icon: <LuFileText />,
    tone: 'green',
  },
  {
    title: 'Développer une idée',
    description: "Structurer un projet d’entreprise",
    prompt: "Aide-moi à structurer une idée d’entreprise adaptée à mon marché local.",
    icon: <LuBriefcaseBusiness />,
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
    title: 'Préparer un plan',
    description: 'Passer rapidement de l’idée à l’action',
    prompt: 'Prépare-moi un plan de travail simple, précis et réaliste.',
    icon: <LuSparkles />,
    tone: 'ink',
  },
]

function loadConversations(): Conversation[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
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

function InlineText({ children }: { children: string }) {
  const parts = children.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index}>{part.slice(2, -2)}</strong>
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={index}>{part.slice(1, -1)}</em>
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
  const [darkMode, setDarkMode] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Record<string, 'up' | 'down'>>({})
  const [notice, setNotice] = useState('')
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const activeConversation = conversations.find((item) => item.id === activeId)
  const messages = activeConversation?.messages ?? []

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('fr')
    return conversations
      .filter((item) => !query || item.title.toLocaleLowerCase('fr').includes(query))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [conversations, search])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
  }, [conversations])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isThinking])

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'
  }, [darkMode])

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
      const isText = /\.(txt|md|csv|json)$/i.test(file.name) || file.type.startsWith('text/')
      if (!isText) {
        setNotice('Pour cette version, ajoutez un fichier TXT, MD, CSV ou JSON.')
        continue
      }
      if (file.size > 300_000) {
        setNotice(`${file.name} dépasse la limite de 300 Ko.`)
        continue
      }
      next.push({ name: file.name, size: file.size, content: await file.text() })
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
      const response = await sendToAgent(apiMessages)
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.content,
        createdAt: Date.now(),
        trace: response.trace,
      }
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
                  accept=".txt,.md,.csv,.json,text/plain,text/csv,application/json"
                  onChange={(event) => void handleFiles(event)}
                  hidden
                />
                <button type="button" onClick={() => fileInputRef.current?.click()} title="Ajouter un fichier texte">
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
