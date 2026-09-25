/** IPC-Vertrag: Kanalnamen und Payloads. Main validiert alles mit Zod. */
import type {
  BootstrapPayload,
  Chat,
  ChatMode,
  ModelInfo,
  Project,
  ProviderConfig,
  Settings,
  StreamEvent
} from './types'

export const Channels = {
  bootstrap: 'app:bootstrap',
  appWach: 'app:wach',
  diktatStand: 'diktat:stand',
  diktatSchreiben: 'diktat:schreiben',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',

  providersList: 'providers:list',
  providersSave: 'providers:save',
  providersDelete: 'providers:delete',
  providersTest: 'providers:test',
  modelsList: 'models:list',

  chatCreate: 'chat:create',
  chatList: 'chat:list',
  chatGet: 'chat:get',
  chatRename: 'chat:rename',
  chatDelete: 'chat:delete',
  chatPin: 'chat:pin',
  chatSetMode: 'chat:set-mode',
  chatSetModel: 'chat:set-model',
  chatSetPermission: 'chat:set-permission',

  messageSend: 'message:send',
  streamStop: 'stream:stop',
  streamEvent: 'stream:event',
  zweigWechseln: 'message:zweig',

  projectCreate: 'project:create',
  projectUpdate: 'project:update',
  projectDelete: 'project:delete',

  gedaechtnisListe: 'gedaechtnis:liste',
  gedaechtnisSpeichern: 'gedaechtnis:speichern',
  gedaechtnisLoeschen: 'gedaechtnis:loeschen',
  gedaechtnisLeeren: 'gedaechtnis:leeren',
  gedaechtnisGeaendert: 'gedaechtnis:geaendert',
  kontextListe: 'kontext:liste',
  kontextHinzu: 'kontext:hinzu',
  kontextLoeschen: 'kontext:loeschen',
  dateiLesen: 'datei:lesen',

  folderPick: 'folder:pick',
  revealPath: 'shell:reveal',
  /** In die Zwischenablage schreiben — über den Hauptprozess, siehe preload. */
  copyText: 'shell:copy-text',

  searchAll: 'search:all',
  plannedList: 'planned:list',
  plannedCreate: 'planned:create',
  plannedUpdate: 'planned:update',
  plannedDelete: 'planned:delete',
  plannedRunNow: 'planned:run-now',
  plannedChanged: 'planned:changed',

  winClose: 'win:close',
  winMinimize: 'win:minimize',
  winToggleMaximize: 'win:toggle-maximize',
  winIsMaximized: 'win:is-maximized',
  winStateChanged: 'win:state-changed',

  /** Hauptprozess bittet die Oberfläche, ein Gespräch zu öffnen (Klick auf eine Meldung). */
  openChatRequest: 'chat:open-request',

  skillsList: 'skills:list',
  skillsSave: 'skills:save',
  skillsRemove: 'skills:remove',
  skillsToggle: 'skills:toggle',
  skillsImport: 'skills:import',
  skillsReveal: 'skills:reveal',

  artifactsList: 'artifacts:list',
  artifactsCreate: 'artifacts:create',
  artifactsUpdate: 'artifacts:update',
  artifactsDelete: 'artifacts:delete',
  artifactsExport: 'artifacts:export',

  documentsCreate: 'documents:create',
  documentsPreview: 'documents:preview',
  documentsOpen: 'documents:open',
  documentsReveal: 'documents:reveal',
  documentsSaveAs: 'documents:save-as',
  documentsWatch: 'documents:watch',
  documentsChanged: 'documents:changed',

  mobileStatus: 'mobile:status',
  mobileStart: 'mobile:start',
  mobileStop: 'mobile:stop',
  mobileNewCode: 'mobile:new-code',

  permissionRequest: 'agent:permission-request',
  permissionRespond: 'agent:permission-respond',
  /** Eine Anfrage ist ohne Antwort erledigt (Zeit abgelaufen, Lauf gestoppt). */
  permissionClosed: 'agent:permission-closed'
} as const

export interface WindowState {
  maximized: boolean
  fullScreen: boolean
}

export interface SendPayload {
  chatId: string
  text: string
  images?: { mediaType: string; dataBase64: string; name?: string }[]
  files?: { name: string; mediaType: string; text: string }[]
  model?: string
  effort?: Settings['effort']
  /** Bearbeiten: die neue Frage ersetzt diese Nachricht (als neue Fassung). */
  ersetzt?: string
  /** Neu erzeugen: auf diese Frage noch einmal antworten. */
  antwortAuf?: string
  /** Tiefere Recherche eingeschaltet: gründlich im Web suchen, mit Quellen. */
  recherche?: boolean
}

export interface ChatCreatePayload {
  mode: ChatMode
  title?: string
  projectId?: string
  folder?: string
  permissionMode?: import('./types').PermissionMode
}

export interface SearchHit {
  kind: 'chat' | 'project' | 'message'
  id: string
  title: string
  subtitle?: string
  updatedAt: number
}

export interface ProviderTestResult {
  ok: boolean
  message: string
  modelCount?: number
  latencyMs?: number
}

/** In `contextBridge` freigegebene Oberfläche (Typ für den Renderer). */
export interface DeskApi {
  bootstrap(): Promise<BootstrapPayload>
  app: {
    wach(): Promise<{ gewuenscht: boolean; laufend: number; wach: boolean }>
    onOpenChat(handler: (chatId: string) => void): () => void
  },
  diktat: {
    stand(): Promise<{ bereit: boolean; motoren: Array<{ id: string; name: string; programm: string; pfad: string | null; modell: string; bereit: boolean; grund: string; befehl: string }>; hinweis: string }>
    schreiben(audioGrundlos: string, sprache?: string): Promise<{ text: string; motor: string } | { error: string }>
  },
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  providers: {
    list(): Promise<ProviderConfig[]>
    save(provider: ProviderConfig, apiKey?: string): Promise<ProviderConfig>
    remove(id: string): Promise<void>
    test(id: string): Promise<ProviderTestResult>
  }
  models: {
    list(refresh?: boolean): Promise<ModelInfo[]>
  }
  chats: {
    create(payload: ChatCreatePayload): Promise<Chat>
    list(): Promise<Chat[]>
    get(id: string): Promise<{ chat: Chat; messages: import('./types').Message[] }>
    rename(id: string, title: string): Promise<Chat>
    remove(id: string): Promise<void>
    pin(id: string, pinned: boolean): Promise<Chat>
    setMode(id: string, mode: ChatMode, folder?: string): Promise<Chat>
    setPermission(id: string, permissionMode: import('./types').PermissionMode): Promise<Chat>
    /** Das gewählte Modell sofort merken — nicht erst, wenn eine Antwort fertig ist. */
    setModel(id: string, model: string): Promise<void>
  }
  messages: {
    send(payload: SendPayload): Promise<{ streamId: string }>
    stop(streamId: string): Promise<void>
    /** Zur vorigen (-1) oder nächsten (1) Fassung dieser Nachricht wechseln. */
    zweig(chatId: string, messageId: string, richtung: -1 | 1): Promise<{ chat: Chat; messages: import('./types').Message[] }>
    onStreamEvent(handler: (event: StreamEvent) => void): () => void
  }
  skills: {
    list(): Promise<import('./types').Skill[]>
    save(payload: { name: string; description: string; body: string; vorher?: string }): Promise<import('./types').Skill>
    remove(name: string): Promise<void>
    toggle(name: string, enabled: boolean): Promise<void>
    /** Ordner wählen lassen und übernehmen; `null`, wenn abgebrochen. */
    importFolder(): Promise<{ neu: string[]; uebersprungen: string[] } | null>
    reveal(name: string): Promise<void>
  }
  projects: {
    create(payload: { name: string; folder?: string; instructions?: string }): Promise<Project>
    update(id: string, patch: Partial<Project>): Promise<Project>
    remove(id: string): Promise<void>
  }
  gedaechtnis: {
    /** Einträge eines Speichers; ohne `projectId` der allgemeine. */
    liste(projectId?: string): Promise<import('./types').Erinnerung[]>
    speichern(eintrag: { id?: string; projectId?: string; thema: string; text: string }): Promise<import('./types').Erinnerung>
    loeschen(id: string): Promise<void>
    leeren(projectId?: string): Promise<void>
    /** Ein Speicher hat sich geändert (auch durch das Modell mitten im Chat). */
    onGeaendert(handler: (projectId: string | null) => void): () => void
  }
  dateien: {
    /** Text aus einem Anhang holen (PDF, Word, OpenDocument, HTML, Text). */
    lesen(name: string, dataBase64: string): Promise<{ text: string; art: string }>
  }
  kontext: {
    liste(projectId: string): Promise<import('./types').ProjektKontext>
    hinzu(projectId: string, name: string, dataBase64: string): Promise<import('./types').ProjektKontext>
    loeschen(projectId: string, id: string): Promise<import('./types').ProjektKontext>
  }
  artifacts: {
    list(): Promise<import('./types').Artifact[]>
    create(payload: { title: string; kind: import('./types').ArtifactKind; body: string; chatId?: string }): Promise<import('./types').Artifact>
    update(id: string, patch: Partial<Pick<import('./types').Artifact, 'title' | 'body' | 'pinned'>>): Promise<import('./types').Artifact>
    remove(id: string): Promise<void>
    export(artifact: import('./types').Artifact): Promise<string | null>
  }
  dialogs: {
    pickFolder(current?: string): Promise<string | null>
  }
  shell: {
    reveal(path: string): Promise<void>
    copy(text: string): Promise<void>
  }
  search: {
    all(query: string): Promise<SearchHit[]>
  }
  planned: {
    list(): Promise<import('./types').PlannedTask[]>
    create(payload: {
      title: string
      prompt: string
      mode: import('./types').ChatMode
      folder?: string
      model?: string
      projectId?: string
      schedule: import('./schedule').Schedule
      enabled?: boolean
    }): Promise<import('./types').PlannedTask>
    update(payload: {
      id: string
      patch: {
        title?: string
        prompt?: string
        mode?: import('./types').ChatMode
        folder?: string
        model?: string
        schedule?: import('./schedule').Schedule
        enabled?: boolean
        nextRunAt?: number
      }
    }): Promise<import('./types').PlannedTask>
    remove(id: string): Promise<void>
    /** Lässt den Auftrag sofort laufen, ohne den Zeitplan zu überspringen. */
    runNow(id: string): Promise<void>
    onChanged(handler: () => void): () => void
  }
  documents: {
    create(payload: {
      kind: import('./types').DocumentKind
      markdown: string
      title?: string
      /** Signaturzeile unter dem Deckeltitel (nur PDF). */
      untertitel?: string
      chatId?: string
    }): Promise<import('./types').DocumentRef>
    preview(path: string): Promise<import('./types').PreviewPayload>
    open(path: string): Promise<void>
    reveal(path: string): Promise<void>
    saveAs(path: string): Promise<string | null>
    watch(path: string | null): void
    onChanged(handler: (payload: { path: string }) => void): () => void
  }

  /** Handy-Zugang: Dienst an, hält die Adresse und den QR-Code bereit. */
  mobile: {
    status(): Promise<import('./types').MobileStatus>
    start(): Promise<import('./types').MobileStatus>
    stop(): Promise<import('./types').MobileStatus>
    newCode(): Promise<import('./types').MobileStatus>
  }

  permissions: {
    onRequest(handler: (request: import('./types').PermissionRequest) => void): () => void
    respond(decision: import('./types').PermissionDecision): void
    onClosed(handler: (id: string) => void): () => void
  }
  win: {
    close(): Promise<void>
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    isMaximized(): Promise<boolean>
    onStateChanged(handler: (state: { maximized: boolean; fullScreen: boolean }) => void): () => void
  }
  platform: NodeJS.Platform | 'web'
  /** Läuft die Oberfläche im Browser über den Fernzugang (MacBook, Handy)? */
  fern: boolean
}
