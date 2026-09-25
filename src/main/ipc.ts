/** IPC-Handler: validiert Eingaben, spricht Store/Runner an, liefert typisierte Antworten. */
import { randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { copyFile, realpath } from 'node:fs/promises'
import { basename } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, nativeTheme } from 'electron'
import { mitSkills, SkillStore } from './skills'
import { mitGedaechtnis } from './gedaechtnis'
import { mitDokumenten } from './dokumente'
import { mitVerlauf } from './verlauf'
import { KAPAZITAET, VOLLSTAENDIG_BIS, textAusDatei } from './kontext'
import { fernEinseitig, fernEmpfaenger, fernOrdnerPruefer, fernRundruf } from './fern'
import { benachrichtige } from './lib/benachrichtigen'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { abschreiben, standErmitteln } from './diktat'
import { wachhaltenSetzen, wachhaltenStatus, type WachhaltenStatus } from './lib/wachhalten'
import { z } from 'zod'
import { Channels, type ProviderTestResult, type SearchHit, type SendPayload } from '@shared/ipc'
import { branding } from '@shared/branding'
import type {
  Artifact,
  ArtifactKind,
  BootstrapPayload,
  Chat,
  DocumentRef,
  Erinnerung,
  ModelInfo,
  PermissionMode,
  PlannedTask,
  PreviewPayload,
  Project,
  ProjektKontext,
  ProviderConfig,
  Settings,
  StreamEvent
} from '@shared/types'
import type { Store } from './db'
import type { SettingsService } from './settings'
import type { ProviderRegistry } from './providers'
import type { ChatRunner } from './chat'
import type { PermissionBroker } from './agent/permissions'
import { accessFor } from './agent/access'
import { createAgentRuntime, createDocumentRuntime } from './agent/tools'
import { createDocument, type DocKind } from './documents/create'
import { previewFile } from './documents/preview'
import { assertAllowed, documentsDir, nextDocumentPath, registerFile, registerRoot } from './documents/registry'
import { Scheduler } from './scheduler'
import { MobileAccess } from './mobile/server'
import { nextRunAt, normalizeSchedule, type Schedule } from '@shared/schedule'
import { log } from './logger'

interface Deps {
  store: Store
  settings: SettingsService
  registry: ProviderRegistry
  runner: ChatRunner
  permissions: PermissionBroker
  getWindow: () => BrowserWindow | null
}

/** Der Handy-Zugang, solange die App läuft. Für das Herunterfahren gebraucht. */
let mobileAccess: MobileAccess | null = null

/** Der Ablaufverwalter für geplante Aufträge. */
let scheduler: Scheduler | null = null

/** Der Ablaufverwalter geht an, sobald die Leitungen stehen. */
export function startScheduler(): void {
  scheduler?.start()
}

/** Stoppt den Verwalter; laufende Läufe werden anderweitig beendet. */
export function stopScheduler(): void {
  scheduler?.stop()
  scheduler = null
}

/** Macht den Handy-Zugang zu, damit beim Beenden kein horchender Dienst bleibt. */
export function shutdownMobile(): void {
  void mobileAccess?.stop()
  mobileAccess = null
}

const providerSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(['ollama', 'openai', 'llama']),
  baseUrl: z.string().regex(/^https?:\/\//i, 'URL muss mit http:// oder https:// beginnen'),
  hasKey: z.boolean(),
  enabled: z.boolean()
})

export const settingsSchema = z.object({
  displayName: z.string().optional(),
  language: z.enum(['de', 'en']).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  startView: z.enum(['home', 'lastChat']).optional(),
  defaultModelChat: z.string().optional(),
  defaultModelAgent: z.string().optional(),
  modellBeimStart: z.enum(['zuletzt', 'fest']).optional(),
  zuletztModell: z.string().max(400).optional(),
  effort: z.enum(['auto', 'off', 'low', 'medium', 'high']).optional(),
  reasoning: z.record(z.enum(['auto', 'off', 'low', 'medium', 'high'])).optional(),
  autoApproveWrites: z.boolean().optional(),
  allowCommands: z.boolean().optional(),
  minimizeToTray: z.boolean().optional(),
  keepAwake: z.boolean().optional(),
  fernzugangAn: z.boolean().optional(),
  modellauswahl: z.array(z.string().min(3).max(400)).max(5).optional(),
  schriftstufe: z.number().int().min(80).max(160).optional(),
  diktierProgramm: z.string().max(600).optional(),
  diktierModell: z.string().max(600).optional(),
  // Die beiden Vorschauwerte fehlten hier — still weggeworfen, nicht abgelehnt,
  // deshalb merkte niemand, dass sich nie etwas davon gemerkt wurde.
  panelWidth: z.number().int().min(320).max(1100).optional(),
  panelSourceView: z.boolean().optional(),
  gedaechtnisAn: z.boolean().optional(),
  gedaechtnisSensibel: z.boolean().optional(),
  chatsDurchsuchen: z.boolean().optional()
})

const erinnerungSchema = z.object({
  id: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  thema: z.string().max(80).default(''),
  text: z.string().min(1, 'Die Erinnerung ist leer.').max(2000)
})

const dateiSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(260),
  dataBase64: z.string().min(1)
})

const sendSchema = z.object({
  chatId: z.string().min(1),
  text: z.string().max(200_000).default(''),
  images: z.array(z.object({ mediaType: z.string(), dataBase64: z.string(), name: z.string().optional() })).optional(),
  files: z.array(z.object({ name: z.string(), mediaType: z.string(), text: z.string() })).optional(),
  model: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high']).optional(),
  ersetzt: z.string().min(1).optional(),
  antwortAuf: z.string().min(1).optional(),
  recherche: z.boolean().optional()
})

function handle<TInput, TOutput>(channel: string, fn: (input: TInput) => TOutput | Promise<TOutput>): void {
  ipcMain.handle(channel, async (_event, input) => fn(input as TInput))
  // Derselbe Empfänger für die Oberfläche im Browser (Fernzugang).
  fernEmpfaenger(channel, (input) => fn(input as TInput))
}

/**
 * Beobachtet genau eine Datei (die offene Vorschau) und meldet Änderungen
 * gedrosselt — das Panel aktualisiert sich damit selbst, wie in der Vorlage.
 */
function watchChannel(channel: string, event: string): void {
  let current: FSWatcher | undefined
  let timer: NodeJS.Timeout | undefined

  fernEinseitig(channel, () => undefined)
  ipcMain.on(channel, (ipcEvent, path: string | null) => {
    current?.close()
    current = undefined
    if (timer) clearTimeout(timer)

    if (!path) return
    const sender = ipcEvent.sender
    try {
      current = watch(path, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          if (!sender.isDestroyed()) sender.send(event, { path: path })
        }, 400)
      })
    } catch {
      // Nicht beobachtbar (Netzwerkpfad, Datei weg) — Vorschau bleibt statisch.
    }
  })
}

function firstHeading(markdown: string): string | undefined {
  const match = /^\s*#\s+(.+)$/m.exec(markdown)
  return match?.[1]?.trim()
}

export function registerIpc(deps: Deps): void {
  const { store, settings, registry, runner, permissions, getWindow } = deps

  // Aus der Ferne nur Arbeitsordner, die schon ein Chat oder Projekt benutzt.
  fernOrdnerPruefer((ordner) => {
    const ziel = ordner.replace(/\/+$/, '')
    return store.listChats().some((c) => c.folder?.replace(/\/+$/, '') === ziel) || store.listProjects().some((p) => p.folder?.replace(/\/+$/, '') === ziel)
  })

  const emit = (event: StreamEvent): void => {
    const fenster = getWindow()
    // Das Fenster reicht alles an die Browser weiter (windows.ts). Ohne
    // Fenster — nur im Leistensymbol — direkt an die Browser.
    if (fenster && !fenster.isDestroyed()) fenster.webContents.send(Channels.streamEvent, event)
    else fernRundruf(Channels.streamEvent, [event])
  }

  /**
   * Der Werkzeugkasten hängt am Modus des Chats: Agent bekommt den vollen
   * Satz fürs Arbeiten im Ordner, der normale Chat nur die Dokumenterzeugung.
   */
  /**
   * Das Werkzeugset für einen Lauf.
   *
   * `geplant` ist der entscheidende Unterschied: ein Lauf, den niemand
   * ausgelöst hat, erbt **keine** globale Freigabe. Die globale Einstellung
   * „ohne Rückfrage schreiben" ist eine Entscheidung für die Gespräche, die du
   * selbst führst — ein Auftrag, der nachts anfällt, soll dadurch nicht
   * ungefragt Dateien anlegen. Er darf das nur, wenn **der Auftrag selbst**
   * (über die Stufe seines Gesprächs) es hergibt.
   */
  const zugriffFuer = (chat: Chat, geplant = false) => {
    const limits = geplant
      ? accessFor(chat.permissionMode, { autoApproveWrites: false, allowCommands: false })
      : accessFor(chat.permissionMode, settings.get())
    return { ...settings.get(), ...limits }
  }
  const runtimeFor = (chat: Chat, geplant = false) => {
    const tuned = zugriffFuer(chat, geplant)
    return chat.mode === 'agent' && chat.folder
      ? createAgentRuntime({
          chatId: chat.id,
          folder: chat.folder,
          settings: tuned,
          permissions
        })
      : chat.mode === 'chat'
        ? createDocumentRuntime({
            chatId: chat.id,
            settings: tuned,
            permissions
          })
        : undefined
  }

  /** Skills liegen als Ordner neben der Datenbank, im offenen SKILL.md-Format. */
  const skillStore = new SkillStore(join(app.getPath('userData'), 'skills'))

  /**
   * Werkzeuge und Skills für einen Lauf. Die aktiven Skills werden bei jedem
   * Lauf frisch gelesen — ein eben angelegter wirkt sofort, ohne Neustart.
   */
  const laufMittel = async (chat: Chat, geplant = false) => {
    const skills = await skillStore.aktive().catch(() => [])
    // Dokumente zuerst: sie merken sich, was create_document erzeugt, und
    // bringen Lesen, Bearbeiten und Zurücksetzen mit.
    const zugriff = zugriffFuer(chat, geplant)
    const mitDok = mitDokumenten(runtimeFor(chat, geplant), {
      store,
      chat,
      folder: chat.mode === 'agent' ? (chat.folder ?? '') : '',
      autoApproveWrites: zugriff.autoApproveWrites,
      permissions
    })
    const tools = mitVerlauf(mitGedaechtnis(mitSkills(mitDok, skills), {
      store,
      chat,
      settings: settings.get(),
      geaendert: gedaechtnisGeaendert
    }), { store, chat, settings: settings.get() })
    return { tools, skills }
  }

  /** Meldet allen Oberflächen (Fenster und Browser), dass ein Speicher sich geändert hat. */
  const gedaechtnisGeaendert = (projectId?: string): void => {
    const fenster = getWindow()
    if (fenster && !fenster.isDestroyed()) fenster.webContents.send(Channels.gedaechtnisGeaendert, projectId ?? null)
    else fernRundruf(Channels.gedaechtnisGeaendert, [projectId ?? null])
  }

  // ----------------------------------------------------------- Geplante Aufträge
  /**
   * Ein geplanter Auftrag läuft wie von Hand eingegeben: eigener Chat, eigener
   * Lauf, dasselbe Werkzeugset. So gibt es keinen Sonderpfad, der sich von dem
   * unterscheidet, was du selbst auslösen könntest.
   */
  const runPlannedTask = async (task: PlannedTask): Promise<{ chatId?: string; error?: string }> => {
    if (task.mode === 'agent' && !task.folder) {
      return { error: 'Dieser Auftrag hat keinen Arbeitsordner. Ohne Ordner kann der Agent nichts anfassen.' }
    }
    const chat = store.createChat({
      mode: task.mode,
      title: task.title,
      folder: task.folder,
      model: task.model,
      projectId: task.projectId,
      permissionMode: 'ask'
    })
    // Der Chat erbt die Zugriffsstufe nicht stillschweigend: geplant laufen
    // lassen heißt nicht, ungefragt handeln zu dürfen. Wer das will, setzt die
    // Stufe im Chat selbst.
    // Ein Anbieter, der ablehnt, **wirft** nicht — er meldet über die
    // Ereignisbahn. Ohne dieses Mitlesen hieße jeder abgelehnte geplante Lauf
    // „fertig", und draußen stünde eine Erfolgsmeldung über einer leeren Antwort.
    let lauffehler: string | null = null
    const sammeln = (ereignis: StreamEvent): void => {
      if (ereignis.type === 'error') lauffehler = ereignis.message
      emit(ereignis)
    }
    try {
      // Stumm: der Planer meldet das Ergebnis selbst — sonst kämen zwei Meldungen.
      await runner.send({ chatId: chat.id, text: task.prompt, model: task.model, stumm: true, ...(await laufMittel(chat, true)) }, sammeln)
      return { chatId: chat.id, error: lauffehler ?? undefined }
    } catch (error) {
      return { chatId: chat.id, error: (error as Error).message }
    }
  }

  const announcePlanned = (): void => {
    getWindow()?.webContents.send(Channels.plannedChanged)
  }

  scheduler = new Scheduler({ store, runTask: runPlannedTask, onChanged: announcePlanned, melden: benachrichtige })

  /** Berechnet den ersten Lauf und lehnt Unbrauchbares ab. */
  const firstRun = (schedule: Schedule | undefined, enabled: boolean | undefined, now = Date.now()): number => {
    const clean = normalizeSchedule(schedule)
    if (!clean) throw new Error('Kein gültiger Zeitplan.')
    if (enabled === false) return 0
    const upcoming = nextRunAt(clean, now)
    if (!upcoming) throw new Error('Der Zeitpunkt liegt in der Vergangenheit.')
    return upcoming
  }

  handle<void, PlannedTask[]>(Channels.plannedList, () => store.listPlanned())
  handle<
    {
      title: string
      prompt: string
      mode: 'chat' | 'agent'
      folder?: string
      model?: string
      projectId?: string
      schedule: Schedule
      enabled?: boolean
    },
    PlannedTask
  >(Channels.plannedCreate, (input) => {
    const prompt = (input.prompt ?? '').trim()
    if (!prompt) throw new Error('Ohne Auftragstext weiß niemand etwas zu tun.')
    if (input.mode === 'agent' && !input.folder) throw new Error('Für den Agenten zuerst einen Arbeitsordner wählen.')
    const schedule = normalizeSchedule(input.schedule)
    if (!schedule) throw new Error('Kein gültiger Zeitplan.')
    const task = store.createPlanned({
      title: input.title ?? '',
      prompt,
      mode: input.mode,
      folder: input.folder,
      model: input.model,
      projectId: input.projectId && store.listProjects().some((p) => p.id === input.projectId) ? input.projectId : undefined,
      schedule,
      enabled: input.enabled,
      nextRunAt: firstRun(schedule, input.enabled)
    })
    log.info('Geplanten Auftrag angelegt', { id: task.id, zeit: new Date(task.nextRunAt).toISOString() })
    announcePlanned()
    void scheduler?.tick()
    return task
  })
  handle<
    {
      id: string
      patch: Partial<{
        title: string
        prompt: string
        mode: 'chat' | 'agent'
        folder: string
        model: string
        schedule: Schedule
        enabled: boolean
        nextRunAt: number
      }>
    },
    PlannedTask
  >(Channels.plannedUpdate, (input) => {
    const existing = store.getPlanned(input.id)
    if (!existing) throw new Error('Auftrag nicht gefunden')
    const patch = { ...input.patch }
    if (patch.schedule) {
      const clean = normalizeSchedule(patch.schedule)
      if (!clean) throw new Error('Kein gültiger Zeitplan.')
      patch.schedule = clean
      // Neuer Zeitplan heißt neuer erste Termin — sonst bleibt ein alter,
      // längst verstrichener stehen.
      patch.nextRunAt = patch.enabled === false ? 0 : firstRun(clean, patch.enabled ?? existing.enabled)
    }
    // Wer einen Auftrag wieder einschaltet, erwartet, dass er bald läuft.
    if (patch.enabled === true && !patch.schedule) {
      patch.nextRunAt = firstRun(patch.schedule ?? existing.schedule, true)
    }
    if (patch.enabled === false) patch.nextRunAt = 0
    const next = store.updatePlanned(input.id, patch)
    if (!next) throw new Error('Auftrag nicht gefunden')
    announcePlanned()
    void scheduler?.tick()
    return next
  })
  handle<{ id: string }, void>(Channels.plannedDelete, (input) => {
    store.deletePlanned(input.id)
    announcePlanned()
  })
  handle<{ id: string }, void>(Channels.plannedRunNow, (input) => {
    const task = store.getPlanned(input.id)
    if (!task) throw new Error('Auftrag nicht gefunden')
    log.info('Geplanten Auftrag sofort ausführen', { id: task.id, titel: task.title })
    // Durch den Verwalter, damit kein zweiter Lauf desselben Auftrags parallel
    // entsteht; der nächste Termin wird von jetzt an gerechnet.
    void scheduler?.runNow(task)
  })

  // Der Fernzugang liefert die Oberfläche selbst aus; eingeschaltet wird er im
  // Fenster (und geht mit der App wieder an, wenn er an war).
  mobileAccess = new MobileAccess({
    // Dieselbe gebaute Oberfläche, die das Fenster lädt.
    oberflaeche: join(__dirname, '../renderer'),
    datenordner: app.getPath('userData'),
    symbole: join(app.getAppPath(), 'build', 'pwa')
  }, {
    // Der Code liegt verschlüsselt neben den API-Schlüsseln.
    lesen: () => settings.getApiKey('fernzugang'),
    merken: (code) => settings.setApiKey('fernzugang', code)
  })

  // War der Zugang beim letzten Beenden an, geht er mit der App wieder an —
  // sonst wäre das MacBook nach jedem Neustart ausgesperrt.
  if (settings.get().fernzugangAn) {
    void mobileAccess.start().catch((fehler: unknown) => log.warn('Mobile-Zugang startete nicht wieder', (fehler as Error).message))
  }

  handle<void, import('@shared/types').MobileStatus>(Channels.mobileStatus, () => mobileAccess!.status())
  handle<void, import('@shared/types').MobileStatus>(Channels.mobileStart, async () => {
    const status = await mobileAccess!.start()
    settings.set({ fernzugangAn: true })
    return status
  })
  handle<void, import('@shared/types').MobileStatus>(Channels.mobileStop, async () => {
    settings.set({ fernzugangAn: false })
    return mobileAccess!.stop()
  })
  handle<void, import('@shared/types').MobileStatus>(Channels.mobileNewCode, () => mobileAccess!.neuerCode())

  handle<void, BootstrapPayload>(Channels.bootstrap, () => ({
    branding: {
      name: branding.name,
      shortName: branding.shortName,
      tagline: branding.tagline,
      accent: branding.accent,
      copyright: branding.copyright,
      webseite: branding.webseite,
      quellcode: branding.quellcode
    },
    settings: settings.get(),
    chats: store.listChats(),
    projects: store.listProjects(),
    providers: registry.list(),
    prefersDark: nativeTheme.shouldUseDarkColors,
    platform: process.platform,
    keychainAvailable: settings.keychainAvailable(),
    autoPrompt: process.env['HESTIA_AUTO_PROMPT'],
    autoMode: (process.env['HESTIA_AUTO_MODE'] as 'chat' | 'agent' | undefined) ?? undefined,
    autoFolder: process.env['HESTIA_AUTO_FOLDER'] ?? undefined,
    autoApprove: process.env['HESTIA_AUTO_APPROVE'] === '1'
  }))

  handle<void, Settings>(Channels.settingsGet, () => settings.get())
  handle<unknown, Settings>(Channels.settingsSet, (input) => {
    const patch = settingsSchema.parse(input) as Partial<Settings>
    const next = settings.set(patch)
    if (patch.theme) nativeTheme.themeSource = patch.theme
    if (patch.keepAwake !== undefined) wachhaltenSetzen(patch.keepAwake)
    return next
  })

  handle<never, WachhaltenStatus>(Channels.appWach, () => wachhaltenStatus())

  // Diktat: erst fragen, was da ist — dann erst aufnehmen.
  handle<never, unknown>(Channels.diktatStand, () => standErmitteln({ programm: settings.get().diktierProgramm, modell: settings.get().diktierModell }))
  handle<{ audioGrundlos: string; sprache?: string }, unknown>(Channels.diktatSchreiben, async (input) => {
    const daten = Buffer.from(String(input.audioGrundlos), 'base64')
    if (daten.length < 2_000) return { error: 'Zu kurz zum Hören.' }
    if (daten.length > 100_000_000) return { error: 'Zu lang für ein Diktat.' }
    const pfad = join(tmpdir(), `hestia-diktat-${Date.now()}.wav`)
    await writeFile(pfad, daten)
    try {
      return await abschreiben(pfad, {
        sprache: input.sprache,
        programm: settings.get().diktierProgramm,
        modell: settings.get().diktierModell
      })
    } catch (fehler) {
      return { error: fehler instanceof Error ? fehler.message : String(fehler) }
    } finally {
      void unlink(pfad)
    }
  })
  // Der Schalter gilt ab sofort, nicht erst nach dem nächsten Neustart.
  wachhaltenSetzen(settings.get().keepAwake)

  handle<void, ProviderConfig[]>(Channels.providersList, () => registry.list())
  handle<{ provider: ProviderConfig; apiKey?: string }, ProviderConfig>(Channels.providersSave, (input) => {
    const parsed = providerSchema.parse(input.provider)
    return registry.save(parsed, input.apiKey)
  })
  handle<{ id: string }, void>(Channels.providersDelete, (input) => {
    registry.remove(input.id)
  })
  handle<{ id: string }, ProviderTestResult>(Channels.providersTest, async (input) => registry.test(input.id))
  handle<{ refresh?: boolean }, ModelInfo[]>(Channels.modelsList, (input) => registry.models(Boolean(input?.refresh)))

  handle<{ mode: 'chat' | 'agent'; title?: string; projectId?: string; folder?: string }, Chat>(
    Channels.chatCreate,
    (input) => store.createChat(input)
  )
  handle<void, Chat[]>(Channels.chatList, () => store.listChats())
  handle<{ id: string }, { chat: Chat; messages: import('@shared/types').Message[] }>(Channels.chatGet, (input) => {
    const chat = store.getChat(input.id)
    if (!chat) throw new Error('Chat nicht gefunden')
    return { chat, messages: store.listMessages(chat.id) }
  })
  handle<{ id: string; title: string }, Chat>(Channels.chatRename, (input) => {
    const chat = store.renameChat(input.id, input.title)
    if (!chat) throw new Error('Chat nicht gefunden')
    return chat
  })
  handle<{ id: string }, void>(Channels.chatDelete, (input) => {
    // Erst den Lauf anhalten — auch wenn das Löschen vom Handy kommt.
    runner.stopChat(input.id)
    store.deleteChat(input.id)
  })
  handle<unknown, void>(Channels.chatSetModel, (roh) => {
    const input = z.object({ id: z.string().min(1), model: z.string().min(3).max(400) }).parse(roh)
    store.setChatModel(input.id, input.model)
  })
  handle<{ id: string; pinned: boolean }, Chat>(Channels.chatPin, (input) => {
    const chat = store.pinChat(input.id, input.pinned)
    if (!chat) throw new Error('Chat nicht gefunden')
    return chat
  })
  handle<{ id: string; mode: 'chat' | 'agent'; folder?: string }, Chat>(Channels.chatSetMode, (input) => {
    const chat = store.setChatMode(input.id, input.mode, input.folder)
    if (!chat) throw new Error('Chat nicht gefunden')
    return chat
  })
  handle<{ id: string; permissionMode: PermissionMode }, Chat>(Channels.chatSetPermission, (input) => {
    const chat = store.setChatPermission(input.id, input.permissionMode)
    if (!chat) throw new Error('Chat nicht gefunden')
    log.info('Zugriffsstufe geändert', { chatId: input.id, stufe: input.permissionMode })
    return chat
  })

  handle<SendPayload, { streamId: string }>(Channels.messageSend, async (input) => {
    const payload = sendSchema.parse(input)
    const chat = store.getChat(payload.chatId)
    if (!chat) throw new Error('Chat nicht gefunden')

    // Werkzeugkasten und Laufbahn sind dieselben wie beim Handy-Zugang — eine
    // Quelle der Wahrheit, damit sich die beiden Wege nicht auseinanderleben.
    const { tools, skills } = await laufMittel(chat)

    if (chat.mode === 'agent' && !chat.folder) {
      // Als Fehler am Aufruf, nicht als Lauf-Ereignis: ohne Lauf gibt es keine
      // Nachricht, in der der Hinweis stehen könnte.
      throw new Error('Für den Agenten zuerst einen Arbeitsordner wählen.')
    }

    log.info('Nachricht gesendet', { chatId: payload.chatId, length: payload.text.length, modus: chat.mode })
    // Der Aufruf endet sofort — der Lauf meldet seinen Zustand über Ereignisse.
    // Würde hier bis zum Ende gewartet, fiele der Rückgabewert erst nach dem
    // fertig-Ereignis ein und würde die Oberfläche „beschäftigt" lassen.
    const streamId = randomUUID()
    void runner
      .send(
      {
        // Dieselbe Kennung, die die Oberfläche zurückbekommt — sonst greift
        // ihr Stop ins Leere und das Modell schreibt ungesehen weiter.
        streamId,
        chatId: payload.chatId,
        text: payload.text,
        images: payload.images?.map((i) => ({ mediaType: i.mediaType, dataBase64: i.dataBase64 })),
        files: payload.files,
        model: payload.model ?? chat.model,
        effort: payload.effort,
        ersetzt: payload.ersetzt,
        antwortAuf: payload.antwortAuf,
        recherche: payload.recherche,
        tools,
        skills
      },
      emit
    )
      .catch((e: unknown) => {
        log.error('Lauf fehlgeschlagen (Außerplanmäßig)', (e as Error).message)
        emit({ streamId, type: 'error', chatId: chat.id, messageId: '', message: (e as Error).message })
      })
    return { streamId }
  })
  handle<{ streamId: string }, void>(Channels.streamStop, (input) => runner.stop(input.streamId))

  // ‹ 2/3 ›: auf eine andere Fassung wechseln — samt allem, was in ihrem Zweig folgt.
  handle<unknown, { chat: Chat; messages: import('@shared/types').Message[] }>(Channels.zweigWechseln, (roh) => {
    const input = z.object({ chatId: z.string().min(1), messageId: z.string().min(1), richtung: z.union([z.literal(-1), z.literal(1)]) }).parse(roh)
    const chat = store.getChat(input.chatId)
    if (!chat) throw new Error('Chat nicht gefunden')
    const schwestern = store.schwestern(input.messageId)
    const jetzt = schwestern.findIndex((m) => m.id === input.messageId)
    const ziel = schwestern[Math.min(schwestern.length - 1, Math.max(0, jetzt + input.richtung))]
    if (ziel && ziel.chatId === chat.id) store.setzeBlatt(chat.id, store.blattUnter(ziel.id))
    return { chat, messages: store.listMessages(chat.id) }
  })

  // ------------------------------------------------------------------ Skills
  const skillSchema = z.object({
    name: z.string().max(64),
    description: z.string().max(2000),
    body: z.string().max(200_000),
    vorher: z.string().max(64).optional()
  })
  handle<void, import('@shared/types').Skill[]>(Channels.skillsList, () => skillStore.list())
  handle<unknown, import('@shared/types').Skill>(Channels.skillsSave, (input) => skillStore.save(skillSchema.parse(input)))
  handle<{ name: string }, void>(Channels.skillsRemove, (input) => skillStore.remove(String(input.name)))
  handle<{ name: string; enabled: boolean }, void>(Channels.skillsToggle, (input) =>
    skillStore.setEnabled(String(input.name), Boolean(input.enabled))
  )
  handle<void, { neu: string[]; uebersprungen: string[] } | null>(Channels.skillsImport, async () => {
    const fenster = getWindow()
    const optionen = {
      title: 'Skill-Ordner übernehmen',
      buttonLabel: 'Übernehmen',
      properties: ['openDirectory' as const]
    }
    const wahl = fenster ? await dialog.showOpenDialog(fenster, optionen) : await dialog.showOpenDialog(optionen)
    if (wahl.canceled || !wahl.filePaths[0]) return null
    return skillStore.importieren(wahl.filePaths[0])
  })
  handle<{ name: string }, void>(Channels.skillsReveal, async (input) => {
    const skill = await skillStore.get(String(input.name))
    if (skill) await shell.openPath(skill.path)
  })

  handle<{ name: string; folder?: string; instructions?: string }, Project>(Channels.projectCreate, (input) =>
    store.createProject(input)
  )
  handle<{ id: string; patch: Partial<Project> }, Project>(Channels.projectUpdate, (input) => {
    const project = store.updateProject(input.id, input.patch)
    if (!project) throw new Error('Projekt nicht gefunden')
    return project
  })
  handle<{ id: string }, void>(Channels.projectDelete, (input) => store.deleteProject(input.id))

  // ---------------------------------------------------------------- Gedächtnis
  handle<{ projectId?: string | null } | undefined, Erinnerung[]>(Channels.gedaechtnisListe, (input) =>
    store.listErinnerungen(input?.projectId ?? undefined)
  )
  handle<unknown, Erinnerung>(Channels.gedaechtnisSpeichern, (roh) => {
    const input = erinnerungSchema.parse(roh)
    const eintrag = input.id
      ? store.updateErinnerung(input.id, { thema: input.thema, text: input.text })
      : store.addErinnerung({ projectId: input.projectId, thema: input.thema, text: input.text })
    if (!eintrag) throw new Error('Erinnerung nicht gefunden')
    gedaechtnisGeaendert(eintrag.projectId)
    return eintrag
  })
  handle<{ id: string }, void>(Channels.gedaechtnisLoeschen, (input) => {
    const eintrag = store.getErinnerung(input.id)
    store.deleteErinnerung(input.id)
    gedaechtnisGeaendert(eintrag?.projectId)
  })
  handle<{ projectId?: string | null } | undefined, void>(Channels.gedaechtnisLeeren, (input) => {
    store.clearErinnerungen(input?.projectId ?? undefined)
    gedaechtnisGeaendert(input?.projectId ?? undefined)
  })

  // ------------------------------------------------------------ Projekt-Kontext
  const kontextVon = (projectId: string): ProjektKontext => {
    const dateien = store.listProjektDateien(projectId)
    const zeichen = dateien.reduce((summe, d) => summe + d.zeichen, 0)
    return { dateien, zeichen, kapazitaet: KAPAZITAET, vollstaendigBis: VOLLSTAENDIG_BIS, suchmodus: zeichen > VOLLSTAENDIG_BIS }
  }
  handle<{ projectId: string }, ProjektKontext>(Channels.kontextListe, (input) => kontextVon(input.projectId))
  handle<unknown, ProjektKontext>(Channels.kontextHinzu, async (roh) => {
    const input = dateiSchema.parse(roh)
    if (!store.listProjects().some((p) => p.id === input.projectId)) throw new Error('Projekt nicht gefunden')
    const daten = Buffer.from(input.dataBase64, 'base64')
    const gelesen = await textAusDatei(input.name, daten)
    if (store.projektZeichen(input.projectId) + gelesen.text.length > KAPAZITAET) {
      throw new Error(`„${input.name}“ passt nicht mehr ins Projekt — die Kapazität ist erschöpft. Erst andere Dateien entfernen.`)
    }
    store.addProjektDatei({ projectId: input.projectId, name: input.name, art: gelesen.art, groesse: daten.length, text: gelesen.text })
    log.info('Kontextdatei aufgenommen', { projekt: input.projectId, name: input.name, zeichen: gelesen.text.length })
    return kontextVon(input.projectId)
  })
  // Anhänge im Eingabefeld: PDF und Word kamen bisher als Binärsalat beim Modell an.
  handle<unknown, { text: string; art: string }>(Channels.dateiLesen, async (roh) => {
    const input = z.object({ name: z.string().min(1).max(260), dataBase64: z.string().min(1) }).parse(roh)
    return textAusDatei(input.name, Buffer.from(input.dataBase64, 'base64'))
  })
  handle<{ id: string; projectId: string }, ProjektKontext>(Channels.kontextLoeschen, (input) => {
    store.deleteProjektDatei(input.id)
    return kontextVon(input.projectId)
  })

  handle<{ current?: string }, string | null>(Channels.folderPick, async (input) => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: input?.current,
      title: 'Ordner für die Arbeit wählen'
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle<{ text: string }, void>(Channels.copyText, (input) => {
    clipboard.writeText(String(input?.text ?? '').slice(0, 1_000_000))
  })
  handle<{ path: string }, void>(Channels.revealPath, async (input) => {
    await shell.openPath(input.path)
  })

  // ------------------------------------------------------------ dokumente
  handle<
    {
      kind: DocKind
      markdown: string
      title?: string
      untertitel?: string
      chatId?: string
    },
    DocumentRef
  >(
    Channels.documentsCreate,
    async (input) => {
      const chat = input.chatId ? store.getChat(input.chatId) : undefined
      const inFolder = chat?.folder
      const title = (input.title ?? '').trim() || firstHeading(input.markdown) || 'Dokument'
      // Der Zielpfad entsteht immer hier — nie aus der Anfrage: über den
      // Fernzugang ließ sich sonst jede Datei im Home-Verzeichnis überschreiben.
      if (!['markdown', 'docx', 'pdf'].includes(input.kind)) throw new Error('Unbekanntes Format')
      const target = nextDocumentPath(input.kind, title, inFolder)

      // Kein Berechtigungsschritt: Dieses Erzeugen geht direkt auf einen
      // Klick in der Oberfläche zurück. Der Agent fragt weiterhin separat.
      const created = await createDocument({
        kind: input.kind,
        path: target,
        markdown: input.markdown,
        title,
        untertitel: input.untertitel
      })
      registerFile(created.path)
      // Auch ein von Hand exportiertes Dokument lässt sich danach im Chat
      // weiterbearbeiten („ergänze im PDF noch …“).
      if (chat) {
        store.speichereDokument({
          chatId: chat.id,
          projectId: chat.projectId,
          pfad: created.path,
          art: created.kind,
          titel: title,
          untertitel: input.untertitel,
          markdown: input.markdown
        })
      }
      return { path: created.path, kind: created.kind, title, bytes: created.bytes }
    }
  )

  handle<{ path: string }, PreviewPayload>(Channels.documentsPreview, async ({ path }) => {
    const safe = await assertAllowed(path)
    return previewFile(safe)
  })
  // Über den Fernzugang dieselbe Vorschau — aber nie aus dem Datenordner der
  // App, in dem die Datenbank liegt. Am Rechner war er für Protokolle gedacht;
  // ein Gerät im Netz braucht ihn nicht.
  fernEmpfaenger(Channels.documentsPreview, async (eingabe) => {
    const safe = await assertAllowed(String((eingabe as { path?: unknown } | undefined)?.path ?? ''))
    const echt = await realpath(safe).catch(() => safe)
    const daten = await realpath(app.getPath('userData')).catch(() => app.getPath('userData'))
    if (echt === daten || echt.startsWith(daten + sep)) throw new Error('Zugriff auf diesen Pfad ist nicht freigegeben')
    return previewFile(safe)
  })

  handle<{ path: string }, void>(Channels.documentsOpen, async ({ path }) => {
    const safe = await assertAllowed(path)
    const failure = await shell.openPath(safe)
    if (failure) throw new Error(failure)
  })

  handle<{ path: string }, void>(Channels.documentsReveal, async ({ path }) => {
    const safe = await assertAllowed(path)
    shell.showItemInFolder(safe)
  })

  handle<{ path: string }, string | null>(Channels.documentsSaveAs, async ({ path }) => {
    const safe = await assertAllowed(path)
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showSaveDialog(win, { defaultPath: basename(safe) })
    if (result.canceled || !result.filePath) return null
    await copyFile(safe, result.filePath)
    registerFile(result.filePath)
    return result.filePath
  })

  for (const chat of store.listChats()) registerRoot(chat.folder)
  for (const project of store.listProjects()) registerRoot(project.folder)
  registerRoot(documentsDir())

  watchChannel(Channels.documentsWatch, Channels.documentsChanged)

  handle<void, Artifact[]>(Channels.artifactsList, () => store.listArtifacts())
  handle<{ title: string; kind: ArtifactKind; body: string; chatId?: string }, Artifact>(Channels.artifactsCreate, (input) =>
    store.createArtifact({
      title: input.title.slice(0, 120) || 'Ohne Titel',
      kind: input.kind,
      body: input.body,
      chatId: input.chatId
    })
  )
  handle<{ id: string; patch: Partial<Pick<Artifact, 'title' | 'body' | 'pinned'>> }, Artifact>(
    Channels.artifactsUpdate,
    (input) => {
      const artifact = store.updateArtifact(input.id, input.patch)
      if (!artifact) throw new Error('Artifact nicht gefunden')
      return artifact
    }
  )
  handle<{ id: string }, void>(Channels.artifactsDelete, (input) => store.deleteArtifact(input.id))
  handle<{ artifact: Artifact }, string | null>(Channels.artifactsExport, async ({ artifact }) => {
    const win = getWindow()
    if (!win) return null
    const extension: Record<ArtifactKind, string> = {
      markdown: 'md',
      html: 'html',
      svg: 'svg',
      code: 'txt',
      text: 'txt'
    }
    const result = await dialog.showSaveDialog(win, {
      title: 'Artifact exportieren',
      defaultPath: `${artifact.title.replace(/[^\w.\-äöüÄÖÜß]+/g, '_')}.${extension[artifact.kind]}`
    })
    if (result.canceled || !result.filePath) return null
    const { writeFile } = await import('node:fs/promises')
    await writeFile(result.filePath, artifact.body, 'utf8')
    return result.filePath
  })

  handle<{ query: string }, SearchHit[]>(Channels.searchAll, (input) => {
    const q = (input?.query ?? '').trim().toLowerCase()
    if (!q) return []
    const hits: SearchHit[] = []
    for (const chat of store.listChats()) {
      if (chat.title.toLowerCase().includes(q)) {
        hits.push({ kind: 'chat', id: chat.id, title: chat.title, subtitle: chat.folder, updatedAt: chat.updatedAt })
      }
    }
    for (const project of store.listProjects()) {
      if (project.name.toLowerCase().includes(q)) {
        hits.push({
          kind: 'project',
          id: project.id,
          title: project.name,
          subtitle: project.folder,
          updatedAt: project.updatedAt
        })
      }
    }
    for (const { chatId, messageId } of store.searchMessages(q, 25)) {
      const chat = store.getChat(chatId)
      if (!chat) continue
      const message = store.listMessages(chatId).find((m) => m.id === messageId)
      const body = message?.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join(' ')
      hits.push({
        kind: 'message',
        id: chatId,
        title: chat.title,
        subtitle: body?.slice(0, 120),
        updatedAt: message?.createdAt ?? chat.updatedAt
      })
    }
    return hits.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30)
  })

  handle<void, void>(Channels.winClose, () => {
    const win = getWindow()
    win?.close()
  })
  handle<void, void>(Channels.winMinimize, () => getWindow()?.minimize())
  handle<void, void>(Channels.winToggleMaximize, () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  handle<void, boolean>(Channels.winIsMaximized, () => Boolean(getWindow()?.isMaximized()))
}
