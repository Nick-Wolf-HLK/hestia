/**
 * Der Bauplan von `window.desk` — einmal für beide Wege.
 *
 * Am Rechner läuft die Oberfläche in Electron und spricht über dessen Kanäle
 * mit dem Hauptprogramm (preload). Im Browser — MacBook, Handy — läuft
 * **dieselbe** Oberfläche und spricht über den Fernzugang (HTTP und eine
 * Ereignisbahn). Beide bauen ihre Schnittstelle aus diesem einen Plan; nur
 * die Leitung darunter ist verschieden. So kann keine Funktion am einen Ort
 * fehlen, weil sie am anderen vergessen wurde.
 */
import { Channels, type DeskApi, type SendPayload } from './ipc'
import type { PermissionRequest, StreamEvent } from './types'

/** Die Leitung: anfragen, einseitig senden, Ereignisse hören. */
export interface Leitung {
  invoke<T>(kanal: string, eingabe?: unknown): Promise<T>
  send(kanal: string, eingabe?: unknown): void
  /** Hört auf ein Ereignis; gibt die Abmeldung zurück. */
  on(kanal: string, hoerer: (...werte: unknown[]) => void): () => void
}

/** Was nur am Rechner geht und im Browser anders gelöst wird. */
export type Besonderheiten = Partial<{
  win: DeskApi['win']
  dialogs: DeskApi['dialogs']
  shell: DeskApi['shell']
  documents: Partial<DeskApi['documents']>
  artifacts: Partial<DeskApi['artifacts']>
  skills: Partial<DeskApi['skills']>
}>

export function bauDesk(leitung: Leitung, plattform: DeskApi['platform'], fern: boolean, anders: Besonderheiten = {}): DeskApi {
  const invoke = <T>(kanal: string, eingabe?: unknown): Promise<T> => leitung.invoke<T>(kanal, eingabe)

  const api: DeskApi = {
    bootstrap: () => invoke(Channels.bootstrap),

    settings: {
      get: () => invoke(Channels.settingsGet),
      set: (patch) => invoke(Channels.settingsSet, patch)
    },
    app: {
      wach: () => invoke(Channels.appWach),
      onOpenChat: (handler) => leitung.on(Channels.openChatRequest, (chatId) => handler(chatId as string))
    },
    diktat: {
      stand: () => invoke(Channels.diktatStand),
      schreiben: (audioGrundlos, sprache) => invoke(Channels.diktatSchreiben, { audioGrundlos, sprache })
    },

    providers: {
      list: () => invoke(Channels.providersList),
      save: (provider, apiKey) => invoke(Channels.providersSave, { provider, apiKey }),
      remove: (id) => invoke(Channels.providersDelete, { id }),
      test: (id) => invoke(Channels.providersTest, { id })
    },

    models: {
      list: (refresh) => invoke(Channels.modelsList, { refresh })
    },

    chats: {
      create: (payload) => invoke(Channels.chatCreate, payload),
      list: () => invoke(Channels.chatList),
      get: (id) => invoke(Channels.chatGet, { id }),
      rename: (id, title) => invoke(Channels.chatRename, { id, title }),
      remove: (id) => invoke(Channels.chatDelete, { id }),
      pin: (id, pinned) => invoke(Channels.chatPin, { id, pinned }),
      setMode: (id, mode, folder) => invoke(Channels.chatSetMode, { id, mode, folder }),
      setModel: (id, model) => invoke(Channels.chatSetModel, { id, model }),
      setPermission: (id, permissionMode) => invoke(Channels.chatSetPermission, { id, permissionMode })
    },

    messages: {
      send: (payload: SendPayload) => invoke(Channels.messageSend, payload),
      stop: (streamId) => invoke(Channels.streamStop, { streamId }),
      zweig: (chatId, messageId, richtung) => invoke(Channels.zweigWechseln, { chatId, messageId, richtung }),
      onStreamEvent: (handler) => leitung.on(Channels.streamEvent, (ereignis) => handler(ereignis as StreamEvent))
    },

    skills: {
      list: () => invoke(Channels.skillsList),
      save: (payload) => invoke(Channels.skillsSave, payload),
      remove: (name) => invoke(Channels.skillsRemove, { name }),
      toggle: (name, enabled) => invoke(Channels.skillsToggle, { name, enabled }),
      importFolder: () => invoke(Channels.skillsImport),
      reveal: (name) => invoke(Channels.skillsReveal, { name }),
      ...anders.skills
    },

    projects: {
      create: (payload) => invoke(Channels.projectCreate, payload),
      update: (id, patch) => invoke(Channels.projectUpdate, { id, patch }),
      remove: (id) => invoke(Channels.projectDelete, { id })
    },
    gedaechtnis: {
      liste: (projectId) => invoke(Channels.gedaechtnisListe, { projectId: projectId ?? null }),
      speichern: (eintrag) => invoke(Channels.gedaechtnisSpeichern, eintrag),
      loeschen: (id) => invoke(Channels.gedaechtnisLoeschen, { id }),
      leeren: (projectId) => invoke(Channels.gedaechtnisLeeren, { projectId: projectId ?? null }),
      onGeaendert: (handler) => leitung.on(Channels.gedaechtnisGeaendert, (projectId) => handler((projectId as string | null) ?? null))
    },
    dateien: {
      lesen: (name, dataBase64) => invoke(Channels.dateiLesen, { name, dataBase64 })
    },
    kontext: {
      liste: (projectId) => invoke(Channels.kontextListe, { projectId }),
      hinzu: (projectId, name, dataBase64) => invoke(Channels.kontextHinzu, { projectId, name, dataBase64 }),
      loeschen: (projectId, id) => invoke(Channels.kontextLoeschen, { projectId, id })
    },

    artifacts: {
      list: () => invoke(Channels.artifactsList),
      create: (payload) => invoke(Channels.artifactsCreate, payload),
      update: (id, patch) => invoke(Channels.artifactsUpdate, { id, patch }),
      remove: (id) => invoke(Channels.artifactsDelete, { id }),
      export: (artifact) => invoke(Channels.artifactsExport, { artifact }),
      ...anders.artifacts
    },

    dialogs: anders.dialogs ?? {
      pickFolder: (current) => invoke(Channels.folderPick, { current })
    },

    shell: anders.shell ?? {
      reveal: (path) => invoke(Channels.revealPath, { path }),
      // Kopieren über Electrons Zwischenablage im Hauptprozess. Die Browser-
      // Schnittstelle fragt dafür die Berechtigung „clipboard-read“ an — die zu
      // gewähren hieße, der Seite das Mitlesen zu erlauben.
      copy: (text) => invoke(Channels.copyText, { text })
    },

    search: {
      all: (query) => invoke(Channels.searchAll, { query })
    },

    documents: {
      create: (payload) => invoke(Channels.documentsCreate, payload),
      preview: (path) => invoke(Channels.documentsPreview, { path }),
      open: (path) => invoke(Channels.documentsOpen, { path }),
      reveal: (path) => invoke(Channels.documentsReveal, { path }),
      saveAs: (path) => invoke(Channels.documentsSaveAs, { path }),
      watch: (path) => leitung.send(Channels.documentsWatch, path),
      onChanged: (handler) => leitung.on(Channels.documentsChanged, (payload) => handler(payload as { path: string })),
      ...anders.documents
    },

    planned: {
      list: () => invoke(Channels.plannedList),
      create: (payload) => invoke(Channels.plannedCreate, payload),
      update: (payload) => invoke(Channels.plannedUpdate, payload),
      remove: (id) => invoke(Channels.plannedDelete, { id }),
      runNow: (id) => invoke(Channels.plannedRunNow, { id }),
      onChanged: (handler) => leitung.on(Channels.plannedChanged, () => handler())
    },

    mobile: {
      status: () => invoke(Channels.mobileStatus),
      start: () => invoke(Channels.mobileStart),
      stop: () => invoke(Channels.mobileStop),
      newCode: () => invoke(Channels.mobileNewCode)
    },

    permissions: {
      onRequest: (handler) => leitung.on(Channels.permissionRequest, (anfrage) => handler(anfrage as PermissionRequest)),
      respond: (decision) => leitung.send(Channels.permissionRespond, decision),
      onClosed: (handler) => leitung.on(Channels.permissionClosed, (id) => handler(id as string))
    },

    win: anders.win ?? {
      close: () => invoke(Channels.winClose),
      minimize: () => invoke(Channels.winMinimize),
      toggleMaximize: () => invoke(Channels.winToggleMaximize),
      isMaximized: () => invoke(Channels.winIsMaximized),
      onStateChanged: (handler) =>
        leitung.on(Channels.winStateChanged, (zustand) => handler(zustand as { maximized: boolean; fullScreen: boolean }))
    },

    platform: plattform,
    fern
  }
  return api
}
