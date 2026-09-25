/** Zentraler Zustand im Renderer: kleiner externer Store ohne Zusatzbibliothek. */
import { useSyncExternalStore } from 'react'
import type { DeskApi } from '@shared/ipc'
import { appendTextPart } from '@shared/parts'
import { DEFAULT_SETTINGS } from '@shared/types'
import type {
  ReasoningChoice,
  Artifact,
  ArtifactKind,
  BootstrapPayload,
  Chat,
  ChatMode,
  ContentPart,
  Message,
  ModelInfo,
  PanelTarget,
  PermissionMode,
  PermissionRequest,
  Project,
  ProviderConfig,
  Settings,
  StreamEvent
} from '@shared/types'

/**
 * Läufe, die schon zu Ende sind. Ein Fehler kann vor der Antwort auf „senden“
 * ankommen (kein Anbieter, Nachricht weg) — ohne diesen Merker setzte
 * sendMessage den Chat danach wieder auf „läuft“, und der Stop-Knopf blieb für immer.
 */
const beendeteLaeufe = new Set<string>()
/** Chats, von denen nur das Ende eines Laufs bekannt ist (vom Handy gestartet) — beim Öffnen ganz laden. */
const teilGeladen = new Set<string>()
/** Suchart je Chat (Websuche oder Tiefenrecherche) — der Schalter bleibt, bis man ihn ausmacht. */
export type Suche = 'web' | 'tief'
export const sucheJeChat = new Map<string, Suche>()

/** Eine Nachricht, die wartet, bis die laufende Antwort fertig ist. */
export interface Eingereiht {
  id: string
  text: string
  images?: { mediaType: string; dataBase64: string; name?: string }[]
  files?: { name: string; mediaType: string; text: string }[]
  model?: string
  suche?: Suche
}

export type ViewName =
  | 'home'
  | 'chat'
  | 'projects'
  | 'project'
  | 'artifacts'
  | 'scheduled'
  | 'dispatch'
  | 'customize'

export interface StreamingState {
  streamId: string
  chatId: string
  messageId: string
}

export interface AppState {
  ready: boolean
  boot?: BootstrapPayload
  settings: Settings
  chats: Chat[]
  projects: Project[]
  artifacts: Artifact[]
  providers: ProviderConfig[]
  models: ModelInfo[]
  view: ViewName
  activeChatId?: string
  /** Das Projekt, dessen Seite offen ist (Ansicht `project`). */
  activeProjectId?: string
  /** Von der Projektseite vorbereiteter Zeitplan; Geplant öffnet damit das Formular. */
  plannedVorlage?: { projectId: string; mode: ChatMode; folder?: string }
  messages: Record<string, Message[]>
  streaming?: StreamingState
  streamingByChat: Record<string, string>
  sidebarOpen: boolean
  searchOpen: boolean
  settingsOpen: boolean
  /** Welcher Bereich der Einstellungen beim Öffnen gezeigt wird. */
  settingsAbschnitt?: string
  /** Offene Prüfkarten des Agenten (über Chats hinweg). */
  permissions: PermissionRequest[]
  /** Rechts angezeigte Datei (eine_slot, wie in der Vorlage). */
  panel: PanelTarget | null
  /** Während einer Antwort nachgeschobene Nachrichten, je Chat in Reihenfolge. */
  warteschlange: Record<string, Eingereiht[]>
  error?: string
}

const initial: AppState = {
  ready: false,
  settings: DEFAULT_SETTINGS,

  chats: [],
  projects: [],
  artifacts: [],
  providers: [],
  models: [],
  messages: {},
  view: 'home',
  streamingByChat: {},
  sidebarOpen: true,
  searchOpen: false,
  settingsOpen: false,
  permissions: [],
  panel: null,
  warteschlange: {}
}

let state: AppState = initial
// Beim Breitziehen mitgelaufene, aber noch nicht gespeicherte Breite.
let pendingPanelWidth: number | undefined
const listeners = new Set<() => void>()

function set(patch: Partial<AppState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(initial)
  )
}

export const appStore = {
  get: () => state,

  async boot(api: DeskApi): Promise<void> {
    const payload = await api.bootstrap()
    set({
      ready: true,
      boot: payload,
      settings: payload.settings,
      chats: payload.chats,
      projects: payload.projects,
      // Ein Teilausfall (z. B. fehlende Tabelle nach Update) darf den Start nicht kippen.
      artifacts: await window.desk.artifacts.list().catch(() => []),
      providers: payload.providers,
      view: payload.settings.startView === 'lastChat' && payload.chats[0] ? 'chat' : 'home',
      activeChatId: payload.settings.startView === 'lastChat' ? payload.chats[0]?.id : undefined
    })
    // Das eigene Gerät fragen, nicht den Rechner: Auf dem Handy im Dunkelmodus
    // zeigte „System folgen“ sonst hell, weil prefersDark vom Rechner stammt. In
    // Electron liefert die Abfrage ohnehin den Wert des Rechners.
    applyTheme(payload.settings, window.matchMedia('(prefers-color-scheme: dark)').matches)
    await this.refreshModels()
  },

  async refreshModels(refresh = false): Promise<void> {
    const models = await window.desk.models.list(refresh)
    set({ models })
    const settings = state.settings
    if (models.length > 0 && !settings.defaultModelChat) {
      const preferred =
        models.find((m) => m.capabilities.tools && m.capabilities.thinking) ?? models.find((m) => m.capabilities.tools) ?? models[0]!
      await this.saveSettings({ defaultModelChat: `${preferred.providerId}|${preferred.id}` })
    }
    // Noch nichts gemerkt (erste Fassung mit dieser Einstellung): das Modell des
    // zuletzt benutzten Chats übernehmen — sonst stünde bis zur ersten Nachricht
    // die alte Vorgabe da.
    if (!state.settings.zuletztModell) {
      const juengster = [...state.chats].filter((c) => c.model).sort((a, b) => b.updatedAt - a.updatedAt)[0]
      if (juengster?.model) await this.saveSettings({ zuletztModell: juengster.model })
    }
  },

  async newChat(mode: ChatMode = 'chat', folder?: string, permissionMode?: PermissionMode, projectId?: string): Promise<Chat> {
    const chat = await window.desk.chats.create({ mode, folder, permissionMode, projectId })
    set({
      chats: [chat, ...state.chats],
      activeChatId: chat.id,
      view: 'chat',
      messages: { ...state.messages, [chat.id]: [] }
    })
    return chat
  },

  async openChat(id: string): Promise<void> {
    set({ view: 'chat', activeChatId: id })
    if (!state.messages[id] || teilGeladen.has(id)) {
      teilGeladen.delete(id)
      const { chat, messages } = await window.desk.chats.get(id)
      set({
        messages: { ...state.messages, [id]: messages },
        chats: state.chats.map((c) => (c.id === id ? chat : c))
      })
    }
  },

  async renameChat(id: string, title: string): Promise<void> {
    const chat = await window.desk.chats.rename(id, title)
    set({ chats: state.chats.map((c) => (c.id === id ? chat : c)) })
  },

  async setChatPermission(id: string, permissionMode: PermissionMode): Promise<void> {
    try {
      const chat = await window.desk.chats.setPermission(id, permissionMode)
      set({ chats: state.chats.map((c) => (c.id === id ? chat : c)) })
    } catch (error) {
      // Ohne die neue Stufe weiß niemand, was der Auftrag darf. Liegt die
      // Änderung nicht in der Datenbank, sagen wir es deutlich — still
      // weiterschalten wäre schlimmer als ein Fehler.
      console.error('Zugriffsstufe ließ sich nicht speichern', error)
      throw error
    }
  },

  async pinChat(id: string): Promise<void> {
    const chat = await window.desk.chats.pin(id, !state.chats.find((c) => c.id === id)?.pinned)
    set({ chats: state.chats.map((c) => (c.id === id ? chat : c)) })
  },

  async deleteChat(id: string): Promise<void> {
    // Eine laufende Antwort anhalten — sonst schreibt das Modell ungesehen weiter.
    if (state.streamingByChat[id]) await this.stopStream(id)
    await window.desk.chats.remove(id)
    const messages = { ...state.messages }
    delete messages[id]
    const streamingByChat = { ...state.streamingByChat }
    delete streamingByChat[id]
    set({
      chats: state.chats.filter((c) => c.id !== id),
      messages,
      streamingByChat,
      activeChatId: state.activeChatId === id ? undefined : state.activeChatId,
      view: state.activeChatId === id ? 'home' : state.view
    })
  },

  async setChatMode(id: string, mode: ChatMode, folder?: string): Promise<void> {
    const chat = await window.desk.chats.setMode(id, mode, folder)
    set({ chats: state.chats.map((c) => (c.id === id ? chat : c)) })
  },

  /** Modell für einen Chat merken (auch vor der ersten Nachricht möglich). */
  async setChatModel(id: string, model: string): Promise<void> {
    set({ chats: state.chats.map((c) => (c.id === id ? { ...c, model } : c)) })
    // Gleich speichern: Sonst setzte das nächste Nachladen der Chatliste (Anheften,
    // Umbenennen, ein anderer Lauf endet) die Wahl stillschweigend zurück.
    await window.desk.chats.setModel(id, model).catch(() => undefined)
  },

  async sendMessage(payload: {
    chatId: string
    text: string
    images?: { mediaType: string; dataBase64: string; name?: string }[]
    files?: { name: string; mediaType: string; text: string }[]
    model?: string
    ersetzt?: string
    antwortAuf?: string
    suche?: Suche
  }): Promise<void> {
    const { suche, ...rest } = payload
    if (suche) sucheJeChat.set(payload.chatId, suche)
    else if (!payload.ersetzt && !payload.antwortAuf) sucheJeChat.delete(payload.chatId)
    try {
      // Der Hauptprozess antwortet sofort; Ende und Fehler kommen als Ereignisse.
      const { streamId } = await window.desk.messages.send({ ...rest, websuche: suche === 'web' || undefined, tiefenrecherche: suche === 'tief' || undefined })
      // Merken, womit zuletzt gesendet wurde: Nach dem nächsten Öffnen ist
      // genau dieses Modell wieder eingestellt.
      const benutzt = payload.model ?? state.chats.find((c) => c.id === payload.chatId)?.model
      if (benutzt && benutzt !== state.settings.zuletztModell) void this.saveSettings({ zuletztModell: benutzt })
      if (beendeteLaeufe.has(streamId)) return
      set({
        streaming: { streamId, chatId: payload.chatId, messageId: '' },
        streamingByChat: { ...state.streamingByChat, [payload.chatId]: streamId }
      })
    } catch (e) {
      const streamingByChat = { ...state.streamingByChat }
      delete streamingByChat[payload.chatId]
      set({ error: (e as Error).message, streaming: undefined, streamingByChat })
      // Bearbeiten und Wiederholen haben die Liste schon gekürzt — den wahren Stand holen.
      const { messages } = await window.desk.chats.get(payload.chatId).catch(() => ({ messages: undefined }))
      if (messages) set({ messages: { ...state.messages, [payload.chatId]: messages } })
    }
  },

  /** Während einer Antwort: die Nachricht wartet und geht danach von allein raus. */
  einreihen(chatId: string, eintrag: Omit<Eingereiht, 'id'>): void {
    const liste = state.warteschlange[chatId] ?? []
    set({ warteschlange: { ...state.warteschlange, [chatId]: [...liste, { ...eintrag, id: crypto.randomUUID() }] } })
    // Lief die Antwort gerade aus, während man tippte: nicht auf ein Ende warten, das schon war.
    if (!state.streamingByChat[chatId]) this.naechsteSenden(chatId)
  },

  ausReihe(chatId: string, id: string): void {
    const liste = (state.warteschlange[chatId] ?? []).filter((e) => e.id !== id)
    set({ warteschlange: { ...state.warteschlange, [chatId]: liste } })
  },

  /** Nach dem Ende einer Antwort: die nächste wartende Nachricht senden. */
  naechsteSenden(chatId: string): void {
    const [naechste, ...rest] = state.warteschlange[chatId] ?? []
    if (!naechste || state.streamingByChat[chatId]) return
    set({ warteschlange: { ...state.warteschlange, [chatId]: rest } })
    const { id: _id, ...nachricht } = naechste
    void this.sendMessage({ chatId, ...nachricht })
  },

  /**
   * Eine eigene Nachricht bearbeiten: sie wird eine neue Fassung, und alles
   * danach entsteht neu. Die alte Fassung bleibt über ‹ 1/2 › erreichbar.
   */
  async bearbeiteNachricht(chatId: string, messageId: string, text: string, model?: string): Promise<void> {
    const liste = state.messages[chatId] ?? []
    const stelle = liste.findIndex((m) => m.id === messageId)
    if (stelle >= 0) set({ messages: { ...state.messages, [chatId]: liste.slice(0, stelle) } })
    await this.sendMessage({ chatId, text, model, ersetzt: messageId })
  },

  /** Auf dieselbe Frage noch einmal antworten — als weitere Fassung. */
  async neuAntworten(chatId: string, antwortId: string, model?: string): Promise<void> {
    const liste = state.messages[chatId] ?? []
    const stelle = liste.findIndex((m) => m.id === antwortId)
    const frage = liste.slice(0, Math.max(0, stelle)).reverse().find((m) => m.role === 'user')
    if (!frage) return
    const bis = liste.findIndex((m) => m.id === frage.id)
    set({ messages: { ...state.messages, [chatId]: liste.slice(0, bis + 1) } })
    await this.sendMessage({ chatId, text: '', model, antwortAuf: frage.id })
  },

  /** ‹ 2/3 ›: zu einer anderen Fassung wechseln, mit allem, was in ihrem Zweig folgt. */
  async wechsleZweig(chatId: string, messageId: string, richtung: -1 | 1): Promise<void> {
    const { chat, messages } = await window.desk.messages.zweig(chatId, messageId, richtung)
    set({ messages: { ...state.messages, [chatId]: messages }, chats: state.chats.map((c) => (c.id === chatId ? chat : c)) })
  },

  async stopStream(chatId: string): Promise<void> {
    const streamId = state.streamingByChat[chatId]
    if (!streamId) return
    // Erst lokal freigeben: der Nutzer soll nie in einem „beschäftigt"-Zustand
    // hängen, selbst wenn ein Anbieter nicht mehr antwortet.
    const streamingByChat = { ...state.streamingByChat }
    delete streamingByChat[chatId]
    set({ streaming: undefined, streamingByChat })
    await window.desk.messages.stop(streamId).catch(() => undefined)
  },

  goHome(): void {
    set({ view: 'home', activeChatId: undefined })
  },

  go(view: ViewName): void {
    set({ view, activeChatId: view === 'home' ? undefined : state.activeChatId })
  },

  /** Die Seite eines Projekts öffnen. */
  openProject(id: string): void {
    set({ view: 'project', activeProjectId: id, activeChatId: undefined })
  },

  /** Einen Zeitplan für ein Projekt anlegen: Geplant öffnet das Formular damit. */
  planeImProjekt(vorlage: { projectId: string; mode: ChatMode; folder?: string }): void {
    set({ plannedVorlage: vorlage, view: 'scheduled' })
  },

  /** Die Vorlage abholen — einmalig, danach ist sie weg. */
  nimmPlannedVorlage(): { projectId: string; mode: ChatMode; folder?: string } | undefined {
    const vorlage = state.plannedVorlage
    if (vorlage) set({ plannedVorlage: undefined })
    return vorlage
  },

  toggleSidebar(force?: boolean): void {
    set({ sidebarOpen: force ?? !state.sidebarOpen })
  },

  setSearchOpen(open: boolean): void {
    set({ searchOpen: open })
  },

  setSettingsOpen(open: boolean, abschnitt?: string): void {
    set({ settingsOpen: open, settingsAbschnitt: open ? abschnitt : undefined })
  },


  async saveSettings(patch: Partial<Settings>): Promise<void> {
    // Sofort übernehmen: Ein Eingabefeld (Anzeigename) verlor sonst Zeichen,
    // weil React bis zur Antwort des Hauptprozesses den alten Wert zurücksetzte.
    set({ settings: { ...state.settings, ...patch } })
    const next = await window.desk.settings.set(patch)
    set({ settings: next })
    if (patch.theme || patch.displayName || patch.language) {
      const boot = state.boot
      if (boot) set({ boot: { ...boot, settings: next } })
    }
    if (patch.theme || patch.schriftstufe) applyTheme(next, window.matchMedia('(prefers-color-scheme: dark)').matches)
  },

  /**
   * Denkstufe für **ein** Modell. `null` nimmt die eigene Vorgabe wieder weg,
   * damit das Modell der allgemeinen folgt.
   */
  async setReasoning(reference: string | undefined, wahl: ReasoningChoice | null): Promise<void> {
    if (!reference) return
    const reasoning = { ...state.settings.reasoning }
    if (wahl === null) delete reasoning[reference]
    else reasoning[reference] = wahl
    await this.saveSettings({ reasoning })
  },

  async saveProvider(provider: ProviderConfig, apiKey?: string): Promise<void> {
    const saved = await window.desk.providers.save(provider, apiKey)
    const exists = state.providers.some((p) => p.id === saved.id)
    set({ providers: exists ? state.providers.map((p) => (p.id === saved.id ? saved : p)) : [...state.providers, saved] })
    await this.refreshModels(true)
  },

  async removeProvider(id: string): Promise<void> {
    await window.desk.providers.remove(id)
    set({ providers: state.providers.filter((p) => p.id !== id) })
    await this.refreshModels(true)
  },

  async createProject(input: { name: string; folder?: string; instructions?: string }): Promise<Project> {
    const project = await window.desk.projects.create(input)
    set({ projects: [project, ...state.projects] })
    return project
  },

  async createArtifact(input: { title: string; kind: ArtifactKind; body: string; chatId?: string }): Promise<Artifact> {
    const artifact = await window.desk.artifacts.create(input)
    set({ artifacts: [artifact, ...state.artifacts] })
    return artifact
  },

  async updateArtifact(id: string, patch: Partial<Pick<Artifact, 'title' | 'body' | 'pinned'>>): Promise<void> {
    const artifact = await window.desk.artifacts.update(id, patch)
    set({ artifacts: state.artifacts.map((a) => (a.id === id ? artifact : a)) })
  },

  async removeArtifact(id: string): Promise<void> {
    await window.desk.artifacts.remove(id)
    set({ artifacts: state.artifacts.filter((a) => a.id !== id) })
  },

  async exportArtifact(artifact: Artifact): Promise<void> {
    const path = await window.desk.artifacts.export(artifact)
    if (path) this.setError(undefined)
  },

  async updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'instructions' | 'pinned' | 'folder' | 'permissionMode'>>): Promise<void> {
    const project = await window.desk.projects.update(id, patch)
    set({ projects: state.projects.map((item) => (item.id === id ? project : item)) })
  },

  async removeProject(id: string): Promise<void> {
    await window.desk.projects.remove(id)
    set({
      projects: state.projects.filter((p) => p.id !== id),
      ...(state.activeProjectId === id ? { activeProjectId: undefined, view: 'projects' as ViewName } : {})
    })
  },

  /** Stream-Ereignisse in den Nachrichten-Zustand mergen. */
  applyStreamEvent(event: StreamEvent): void {
    const messagesFor = (list: Message[] = []): Message[] => list.map((m) => ({ ...m }))
    const list = messagesFor(state.messages[event.chatId])
    const index = list.findIndex((m) => m.id === event.messageId)
    if (index < 0) {
      // Erste Nachricht des Laufs (start-Ereignis) → Platzhalter einfügen.
      if (event.type === 'start') {
        if (!state.messages[event.chatId]) teilGeladen.add(event.chatId)
        // Anderswo angelegt (Handy, geplanter Auftrag): sofort in die Seitenleiste,
        // nicht erst, wenn der Lauf fertig ist.
        if (!state.chats.some((c) => c.id === event.chatId)) void window.desk.chats.list().then((chats) => set({ chats }))
        // Erst die Frage, dann der Platzhalter der Antwort — in der Reihenfolge,
        // in der sie auch in der Datenbank stehen.
        const frage = event.userMessage
        if (frage && !list.some((m) => m.id === frage.id)) list.push(frage)
        const placeholder: Message = {
          id: event.messageId,
          chatId: event.chatId,
          role: 'assistant',
          parts: [],
          createdAt: Date.now(),
          zweig: event.zweig
        }
        set({ messages: { ...state.messages, [event.chatId]: [...list, placeholder] } })
      }
      // Fertig für eine Antwort, die hier nie ankam (Chat nicht geladen): trotzdem
      // freigeben — sonst bliebe „läuft“ stehen und die Warteschlange hinge.
      if (event.type === 'done') {
        beendeteLaeufe.add(event.streamId)
        const streamingByChat = { ...state.streamingByChat }
        if (!streamingByChat[event.chatId] || streamingByChat[event.chatId] === event.streamId) delete streamingByChat[event.chatId]
        set({ streaming: state.streaming?.chatId === event.chatId ? undefined : state.streaming, streamingByChat })
        setTimeout(() => this.naechsteSenden(event.chatId), 0)
      }
      // Gescheitert, bevor es eine Antwort gab: freigeben und laut sagen.
      if (event.type === 'error') {
        beendeteLaeufe.add(event.streamId)
        const streamingByChat = { ...state.streamingByChat }
        if (!streamingByChat[event.chatId] || streamingByChat[event.chatId] === event.streamId) delete streamingByChat[event.chatId]
        set({ error: event.message, streaming: state.streaming?.chatId === event.chatId ? undefined : state.streaming, streamingByChat })
        setTimeout(() => this.naechsteSenden(event.chatId), 0)
        // Beim Bearbeiten wurde die Liste schon gekürzt — den wahren Stand nachladen.
        void Promise.resolve()
          .then(() => window.desk.chats.get(event.chatId))
          .then(({ messages }) => set({ messages: { ...state.messages, [event.chatId]: messages } }))
          .catch(() => undefined)
      }
      return
    }
    const message = { ...list[index]!, parts: [...list[index]!.parts] }

    switch (event.type) {
      case 'delta_text': {
        // An den letzten Textanteil, wenn es einer ist — sonst fängt nach einem
        // Werkzeugblock ein neuer an. Sonst klebt die Erzählung der Schritte
        // zu einem Satz zusammen und die Reihenfolge verliert ihren Sinn.
        message.parts = appendTextPart(message.parts, event.text)
        break
      }
      case 'delta_thinking': {
        const existing = message.parts.find((p) => p.type === 'thinking')
        if (existing && existing.type === 'thinking') existing.text += event.text
        else message.parts.unshift({ type: 'thinking', text: event.text })
        break
      }
      case 'tool_call':
        message.parts.push({ type: 'tool_call', id: event.callId, tool: event.tool, args: event.args })
        break
      case 'tool_result':
        message.parts.push({
          type: 'tool_result',
          id: event.callId,
          tool: event.tool,
          ok: event.ok,
          output: event.preview
        })
        break
      case 'document':
        message.parts.push({
          type: 'document',
          path: event.path,
          kind: event.kind,
          title: event.title,
          bytes: event.bytes
        })
        break
      case 'usage': {
        message.usage = { input: event.input, output: event.output }
        // Erst der Schlussschritt bringt die ausgerechneten Werte; die laufen
        // als eigener Teil an die Antwort, damit die Zeile auch nach dem
        // Neustart noch da ist.
        if (typeof event.perSecond === 'number' && typeof event.outputTokens === 'number') {
          const part: ContentPart = {
            type: 'metrics',
            outputTokens: event.outputTokens,
            inputTokens: event.inputTokens,
            durationMs: event.durationMs ?? 0,
            perSecond: event.perSecond,
            estimated: event.estimated ?? false
          }
          const without = message.parts.filter((p) => p.type !== 'metrics')
          message.parts = [...without, part]
        }
        break
      }
      case 'error': {
        // Ein gescheiterter Lauf meldet kein „fertig“ — ohne das hier blieb die
        // Oberfläche bei „Denkt nach …“ und einem Stop-Knopf stehen.
        message.error = event.message
        beendeteLaeufe.add(event.streamId)
        const streamingByChat = { ...state.streamingByChat }
        // Nur der eigene Lauf gibt frei: das späte Ende eines gestoppten Laufs darf
        // den neuen, schon gestarteten nicht als fertig melden.
        if (!streamingByChat[event.chatId] || streamingByChat[event.chatId] === event.streamId) delete streamingByChat[event.chatId]
        set({
          messages: { ...state.messages, [event.chatId]: withMessage(list, message) },
          streaming: state.streaming?.chatId === event.chatId ? undefined : state.streaming,
          streamingByChat
        })
        void window.desk.chats.list().then((chats) => set({ chats }))
        setTimeout(() => this.naechsteSenden(event.chatId), 0)
        return
      }
      case 'done': {
        beendeteLaeufe.add(event.streamId)
        const streamingByChat = { ...state.streamingByChat }
        if (!streamingByChat[event.chatId] || streamingByChat[event.chatId] === event.streamId) delete streamingByChat[event.chatId]
        set({
          messages: { ...state.messages, [event.chatId]: withMessage(list, message) },
          streaming: state.streaming?.messageId === event.messageId ? undefined : state.streaming,
          streamingByChat
        })
        void window.desk.chats.list().then((chats) => set({ chats }))
        setTimeout(() => this.naechsteSenden(event.chatId), 0)
        return
      }
      case 'start':
        return
    }

    set({ messages: { ...state.messages, [event.chatId]: withMessage(list, message) } })

    // Frisch erzeugte Dokumente erscheinen sofort rechts — wie in der Vorlage.
    if (event.type === 'document' && event.chatId === state.activeChatId) {
      this.openPanel({ path: event.path, title: event.title })
    }
  },

  beginStream(streamId: string, chatId: string): void {
    set({ streaming: { streamId, chatId, messageId: '' }, streamingByChat: { ...state.streamingByChat, [chatId]: streamId } })
  },

  clearStream(chatId: string): void {
    const streamingByChat = { ...state.streamingByChat }
    delete streamingByChat[chatId]
    set({ streaming: undefined, streamingByChat })
  },

  setError(message?: string): void {
    set({ error: message })
  },

  // ------------------------------------------------------------ Vorschau-Panel
  openPanel(target: PanelTarget): void {
    // Schon offen: nur neu laden. Die Dateiwache allein reicht nicht — am Handy
    // gibt es sie nicht, und dort blieb nach einer Änderung der alte Stand stehen.
    if (state.panel?.path === target.path) {
      set({ panel: { ...state.panel, stand: (state.panel.stand ?? 0) + 1 } })
      return
    }
    // Ein zweites Dokument im schon offenen Panel behält das Maß, das jemand
    // gerade eingestellt hat. Geteilt wird beim Öffnen in ein leeres Panel.
    const offenVorher = state.panel !== null && state.panel !== undefined
    set({ panel: target })
    window.desk.documents.watch(target.path)
    if (!offenVorher) this.bildschirmTeilen()
  },

  /**
   * Den Bildschirm teilen: Text und Vorschau **gleich groß**.
   *
   * Die halbe Fläche rechts neben der Seitenleiste ist die Antwort auf „das
   * PDF wurde gleich ganz groß gezogen" — die Vorschau war bisher so breit, wie
   * sie beim letzten Mal war, und das konnte fast das ganze Fenster sein.
   */
  bildschirmTeilen(): void {
    if (typeof document === 'undefined') return
    // Der geteilte Platz ist das Fenster ohne die Seitenleiste. Bewusst nicht
    // die Hauptfläche im selben Augenblick gemessen: in dem Moment, in dem die
    // Vorschau geöffnet wird, ist sie mal schon da und mal noch nicht — und
    // einmal war sie das halbe von zu viel.
    const seitenleiste = document.querySelector('.sidebar, aside')?.getBoundingClientRect().width ?? 268
    this.setPanelWidth(Math.round((window.innerWidth - seitenleiste) / 2))
  },

  closePanel(): void {
    set({ panel: null })
    window.desk.documents.watch(null)
  },

  /**
   * Breite setzen. Beim Ziehen gilt: mitlaufen ohne Schreiben — sonst landet
   * jeder Pixelzug in der Datenbank. Begrenzt auf 320 bis 1100 Pixel.
   */
  setPanelWidth(width: number, persist = true): void {
    const bounded = Math.min(Math.max(Math.round(width), 320), 1100)
    set({ settings: { ...state.settings, panelWidth: bounded } })
    if (persist) void this.saveSettings({ panelWidth: bounded })
    else pendingPanelWidth = bounded
  },

  /**
   * Die beim Ziehen mitgelaufene Breite erst loslassen, dann festschreiben.
   *
   * Wer die wirklich stehende Breite mitteilt, verhindert ein gemerktes Maß,
   * das es gar nicht gibt: Die Zeigerrechnung kann über den Platz hinaus wollen,
   * den das Fenster hergibt — gemerkt wurde 1100, zu sehen waren 972.
   */
  commitPanelWidth(breite?: number): void {
    if (pendingPanelWidth === undefined && breite === undefined) return
    const gemerkt = breite !== undefined ? Math.min(Math.max(Math.round(breite), 320), 1100) : pendingPanelWidth
    pendingPanelWidth = undefined
    if (gemerkt !== undefined) void this.saveSettings({ panelWidth: gemerkt })
  },

  togglePanelSource(): void {
    void this.saveSettings({ panelSourceView: !state.settings.panelSourceView })
  },

  async createDocument(input: {
    kind: import('@shared/types').DocumentKind
    markdown: string
    title?: string
    chatId?: string
  }): Promise<import('@shared/types').DocumentRef> {
    const doc = await window.desk.documents.create(input)
    this.openPanel({ path: doc.path, title: doc.title })
    return doc
  },

  /** Prüfkarten an- und abmelden; Antworten gehen zurück an den Main-Prozess. */
  watchPermissions(): () => void {
    const ab = window.desk.permissions.onRequest((request) => {
      if (state.permissions.some((entry) => entry.id === request.id)) return
      set({ permissions: [...state.permissions, request] })
      // Automatisierter Prüflauf: Freigaben ohne Klick erteilen.
      if (state.boot?.autoApprove) void this.answerPermission(request.id, true, true)
    })
    const zu = window.desk.permissions.onClosed((id) => {
      set({ permissions: state.permissions.filter((entry) => entry.id !== id) })
    })
    return () => {
      ab()
      zu()
    }
  },

  async answerPermission(id: string, allowed: boolean, remember = false): Promise<void> {
    window.desk.permissions.respond({ id, allowed, remember })
    set({ permissions: state.permissions.filter((entry) => entry.id !== id) })
  },
}

function withMessage(list: Message[], message: Message): Message[] {
  const index = list.findIndex((m) => m.id === message.id)
  if (index < 0) return [...list, message]
  const next = [...list]
  next[index] = message
  return next
}

export function applyTheme(settings: Settings, prefersDark: boolean): void {
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.lang = settings.language
  schriftAnwenden(settings.schriftstufe)
}

/**
 * Die Schriftgröße.
 *
 * Die Oberfläche rechnet an vielen Stellen in Pixeln, deshalb skaliert ein
 * reiner Schriftwert nur das, was auf einer Grundgröße aufbaut — und der Rest
 * bliebe klein. Wirksam wird deshalb die Fensterstufe: Schrift wird größer, und
 * die Abstände folgen, damit nichts zerläuft. Was dabei wirklich größer wird,
 * ist die Schrift; die Zeilenhöhen bleiben im Verhältnis.
 */
export function schriftAnwenden(stufe: number): void {
  const geklemmt = Math.min(160, Math.max(80, Math.round(stufe || 100)))
  document.documentElement.style.zoom = String(geklemmt / 100)
  document.documentElement.style.setProperty('--schrift-stufe', String(geklemmt / 100))
}

export { appStore as store }
