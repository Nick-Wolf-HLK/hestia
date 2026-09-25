/**
 * Persistenz auf SQLite-Basis über das in Node eingebaute `node:sqlite`
 * (Electron 41 bündelt Node 24 → kein natives Zusatzmodul nötig).
 */
import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { dirname, join } from 'node:path'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type {
  Artifact,
  Chat,
  Erinnerung,
  PlannedTask,
  ProjektDatei,
  ChatMode,
  Message,
  PermissionMode,
  Project,
  ProviderConfig,
  ProviderKind
} from '@shared/types'
import type { Schedule } from '@shared/schedule'
import type { Gestaltung } from './documents/markdown'
import { log } from './logger'

const SCHEMA_VERSION = 8

type Row = Record<string, unknown>

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}
function asNum(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
function asBool(value: unknown): boolean {
  return value === 1 || value === true || value === '1'
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function rowToMessage(r: Row): Message {
  return {
    id: asText(r.id),
    chatId: asText(r.chat_id),
    role: asText(r.role, 'user') as Message['role'],
    parts: parseJson(r.parts, []),
    createdAt: asNum(r.created_at),
    usage: r.usage ? parseJson(r.usage, undefined) : undefined,
    error: typeof r.error === 'string' ? r.error : undefined,
    parentId: typeof r.parent_id === 'string' ? r.parent_id : undefined
  }
}

function rowToChat(r: Row): Chat {
  return {
    id: asText(r.id),
    title: asText(r.title, 'Neuer Chat'),
    mode: asText(r.mode, 'chat') as ChatMode,
    projectId: typeof r.project_id === 'string' ? r.project_id : undefined,
    folder: typeof r.folder === 'string' ? r.folder : undefined,
    permissionMode:
      r.permission_mode === 'ask' || r.permission_mode === 'autoWrites' || r.permission_mode === 'everything'
        ? r.permission_mode
        : undefined,
    pinned: asBool(r.pinned),
    createdAt: asNum(r.created_at),
    updatedAt: asNum(r.updated_at),
    model: typeof r.model === 'string' ? r.model : undefined
  }
}

function rowToProject(r: Row): Project {
  return {
    id: asText(r.id),
    name: asText(r.name, 'Projekt'),
    folder: typeof r.folder === 'string' ? r.folder : undefined,
    permissionMode:
      r.permission_mode === 'ask' || r.permission_mode === 'autoWrites' || r.permission_mode === 'everything'
        ? r.permission_mode
        : undefined,
    instructions: typeof r.instructions === 'string' ? r.instructions : undefined,
    pinned: asBool(r.pinned),
    createdAt: asNum(r.created_at),
    updatedAt: asNum(r.updated_at)
  }
}

function rowToArtifact(r: Row): Artifact {
  return {
    id: asText(r.id),
    title: asText(r.title, 'Ohne Titel'),
    kind: asText(r.kind, 'markdown') as Artifact['kind'],
    body: asText(r.body),
    chatId: typeof r.chat_id === 'string' ? r.chat_id : undefined,
    pinned: asBool(r.pinned),
    createdAt: asNum(r.created_at),
    updatedAt: asNum(r.updated_at)
  }
}

/** Liest den Zeitplan aus dem JSON-Text; unsinnige Pläne bleiben ungenutzt. */
function rowToErinnerung(r: Row): Erinnerung {
  return {
    id: asText(r.id),
    projectId: typeof r.project_id === 'string' ? r.project_id : undefined,
    thema: asText(r.thema, 'Allgemein'),
    text: asText(r.text),
    chatId: typeof r.chat_id === 'string' ? r.chat_id : undefined,
    createdAt: asNum(r.created_at),
    updatedAt: asNum(r.updated_at)
  }
}

/** Ein erzeugtes Dokument mit seiner Quelle — nur im Hauptprozess. */
export interface GespeichertesDokument {
  id: string
  chatId?: string
  projectId?: string
  pfad: string
  art: 'markdown' | 'docx' | 'pdf'
  titel: string
  untertitel?: string
  markdown: string
  gestaltung?: Gestaltung
  version: number
  createdAt: number
  updatedAt: number
}

function rowToDokument(r: Row): GespeichertesDokument {
  return {
    id: asText(r.id),
    chatId: typeof r.chat_id === 'string' ? r.chat_id : undefined,
    projectId: typeof r.project_id === 'string' ? r.project_id : undefined,
    pfad: asText(r.pfad),
    art: asText(r.art, 'markdown') as GespeichertesDokument['art'],
    titel: asText(r.titel),
    untertitel: typeof r.untertitel === 'string' ? r.untertitel : undefined,
    markdown: asText(r.markdown),
    gestaltung: parseJson<Gestaltung | undefined>(r.gestaltung, undefined),
    version: asNum(r.version) || 1,
    createdAt: asNum(r.created_at),
    updatedAt: asNum(r.updated_at)
  }
}

function rowToProjektDatei(r: Row): ProjektDatei {
  return {
    id: asText(r.id),
    projectId: asText(r.project_id),
    name: asText(r.name),
    art: asText(r.art),
    groesse: asNum(r.groesse),
    zeichen: asNum(r.zeichen),
    createdAt: asNum(r.created_at)
  }
}

/** Wörter, die in fast jeder Nachricht stehen — für die Chatsuche wertlos. */
const FUELLWOERTER = new Set([
  'der', 'die', 'das', 'und', 'oder', 'aber', 'ein', 'eine', 'einen', 'einem', 'einer', 'ist', 'sind', 'war', 'waren', 'mit', 'von', 'für',
  'auf', 'aus', 'bei', 'nach', 'wie', 'was', 'wer', 'wir', 'ihr', 'sie', 'ich', 'mir', 'mich', 'dir', 'dich', 'nicht', 'noch', 'auch', 'nur',
  'dass', 'den', 'dem', 'des', 'hat', 'habe', 'haben', 'wird', 'werden', 'kann', 'soll', 'über', 'unter', 'zum', 'zur', 'the', 'and', 'for',
  'you', 'that', 'this', 'with', 'what', 'type', 'text', 'thinking'
])

/** Länge eines Abschnitts im Suchindex und wie weit sich Nachbarn überlappen. */
const ABSCHNITT = 1400
const UEBERLAPPUNG = 200

/** Text in überlappende Abschnitte zerlegen — bevorzugt an Absatzgrenzen. */
export function abschnitte(text: string): string[] {
  const teile: string[] = []
  let start = 0
  while (start < text.length) {
    let ende = Math.min(text.length, start + ABSCHNITT)
    if (ende < text.length) {
      const absatz = text.lastIndexOf('\n\n', ende)
      const satz = text.lastIndexOf('. ', ende)
      const grenze = absatz > start + ABSCHNITT / 2 ? absatz : satz > start + ABSCHNITT / 2 ? satz + 1 : ende
      ende = grenze
    }
    const stueck = text.slice(start, ende).trim()
    if (stueck) teile.push(stueck)
    if (ende >= text.length) break
    start = Math.max(ende - UEBERLAPPUNG, start + 1)
  }
  return teile
}

/**
 * Eine Suchanfrage für FTS5: jedes Wort einzeln in Anführungszeichen und mit
 * ODER verknüpft. So stolpert der Index weder über Sonderzeichen noch über
 * Wörter wie AND/NOT, und ein Treffer muss nicht jedes Wort enthalten.
 */
export function ftsAnfrage(anfrage: string): string {
  const woerter = anfrage
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((wort) => wort.length > 1)
    .slice(0, 16)
  return woerter.map((wort) => `"${wort}"`).join(' OR ')
}

function rowToPlanned(r: Row): PlannedTask {
  return {
    id: asText(r.id),
    title: asText(r.title, 'Geplanter Auftrag'),
    prompt: asText(r.prompt),
    mode: asText(r.mode, 'chat') as ChatMode,
    folder: typeof r.folder === 'string' ? r.folder : undefined,
    model: typeof r.model === 'string' ? r.model : undefined,
    projectId: typeof r.project_id === 'string' ? r.project_id : undefined,
    schedule: parseJson<Schedule>(r.schedule, { kind: 'once', at: 0 }),
    enabled: asBool(r.enabled),
    nextRunAt: asNum(r.next_run_at),
    lastRunAt: typeof r.last_run_at === 'number' ? r.last_run_at : undefined,
    lastChatId: typeof r.last_chat_id === 'string' ? r.last_chat_id : undefined,
    lastError: typeof r.last_error === 'string' ? r.last_error : undefined,
    createdAt: asNum(r.created_at),
    updatedAt: asNum(r.updated_at)
  }
}

function rowToProvider(r: Row): ProviderConfig {
  return {
    id: asText(r.id),
    label: asText(r.label),
    kind: asText(r.kind, 'ollama') as ProviderKind,
    baseUrl: asText(r.base_url),
    hasKey: asBool(r.has_key),
    enabled: asBool(r.enabled)
  }
}

/** Stufe 1: Grundgerüst. Spätere Stufen stehen in MIGRATIONS. */
const BASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    folder TEXT,
    instructions TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    mode TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    folder TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    model TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at DESC);
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    parts TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    usage TEXT,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    kind TEXT NOT NULL,
    base_url TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    has_key INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS planned (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    mode TEXT NOT NULL,
    folder TEXT,
    model TEXT,
    schedule TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    next_run_at INTEGER NOT NULL DEFAULT 0,
    last_run_at INTEGER,
    last_chat_id TEXT,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_planned_next ON planned(next_run_at);
`

/** Stufe 2: eigenständige Artifacts. */
const MIGRATIONS: Record<number, string> = {
  // Stufe 7: das Gespräch als Baum — Nachricht bearbeiten, Antwort neu
  // erzeugen, zwischen Fassungen wechseln. Bestehende Chats werden zu einer
  // geraden Linie verkettet: jede Nachricht hängt an ihrer Vorgängerin.
  7: `
    ALTER TABLE messages ADD COLUMN parent_id TEXT;
    ALTER TABLE chats ADD COLUMN blatt_id TEXT;
    UPDATE messages SET parent_id = (
      SELECT m2.id FROM messages m2
       WHERE m2.chat_id = messages.chat_id
         AND (m2.created_at < messages.created_at OR (m2.created_at = messages.created_at AND m2.rowid < messages.rowid))
       ORDER BY m2.created_at DESC, m2.rowid DESC LIMIT 1
    );
    UPDATE chats SET blatt_id = (
      SELECT id FROM messages WHERE chat_id = chats.id ORDER BY created_at DESC, rowid DESC LIMIT 1
    );
    CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id);
  `,
  // Stufe 6: erzeugte Dokumente mit ihrer Quelle und jeder früheren Fassung —
  // damit „ergänze noch eine Zeile“ das Dokument ändert, statt ein neues zu
  // schreiben, und „mach das rückgängig“ geht.
  6: `
    CREATE TABLE IF NOT EXISTS dokumente (
      id TEXT PRIMARY KEY,
      chat_id TEXT,
      project_id TEXT,
      pfad TEXT NOT NULL,
      art TEXT NOT NULL,
      titel TEXT NOT NULL,
      untertitel TEXT,
      markdown TEXT NOT NULL,
      gestaltung TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dokumente_chat ON dokumente(chat_id);
    CREATE INDEX IF NOT EXISTS idx_dokumente_projekt ON dokumente(project_id);
    CREATE INDEX IF NOT EXISTS idx_dokumente_pfad ON dokumente(pfad);
    CREATE TABLE IF NOT EXISTS dokument_versionen (
      dokument_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      titel TEXT NOT NULL,
      untertitel TEXT,
      markdown TEXT NOT NULL,
      gestaltung TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (dokument_id, version)
    );
  `,
  // Stufe 5: Gedächtnis und Projekt-Kontext. Die Abschnitte der Kontextdateien
  // stehen in einem Volltextindex — der Suchmodus braucht kein Zusatzmodell.
  5: `
    CREATE TABLE IF NOT EXISTS erinnerungen (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      thema TEXT NOT NULL,
      text TEXT NOT NULL,
      chat_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_erinnerungen_projekt ON erinnerungen(project_id);
    CREATE TABLE IF NOT EXISTS projekt_dateien (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      art TEXT NOT NULL,
      groesse INTEGER NOT NULL,
      zeichen INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_projekt_dateien_projekt ON projekt_dateien(project_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS projekt_abschnitte USING fts5(
      text,
      datei_id UNINDEXED,
      project_id UNINDEXED,
      nr UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    ALTER TABLE planned ADD COLUMN project_id TEXT;
  `,
  // Stufe 4: geplante Aufträge.
  4: `
    CREATE TABLE IF NOT EXISTS planned (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      mode TEXT NOT NULL,
      folder TEXT,
      model TEXT,
      schedule TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER,
      last_chat_id TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_planned_next ON planned(next_run_at);
  `,
  // Stufe 3: jede Unterhaltung trägt ihre eigene Zugriffsstufe. Die Spalten
  // entstehen erst hier — eine neue Datenbank läuft alle Stufen mit und würde
  // sich sonst selbst im Weg stehen („duplicate column").
  3: `
    ALTER TABLE chats ADD COLUMN permission_mode TEXT;
    ALTER TABLE projects ADD COLUMN permission_mode TEXT;
  `,
  2: `
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      body TEXT NOT NULL,
      chat_id TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `,
  // Stufe 8: der Arbeitsmodus heißt jetzt „Agent“. Bestehende Chats, geplante
  // Aufträge und die Modellvorgabe ziehen mit.
  8: `
    UPDATE chats SET mode = 'agent' WHERE mode = 'cowork';
    UPDATE planned SET mode = 'agent' WHERE mode = 'cowork';
    UPDATE settings SET value = replace(value, '"defaultModelCowork"', '"defaultModelAgent"') WHERE key = 'settings';
  `
}

/**
 * Datenpfad-Wanderung nach der Umbenennung: früher lag die Datenbank unter
 * <userData>/hearth.db bzw. im Ordner "hearthdesk". Fehlt die neue Datei und
 * gibt es eine alte, wird einmalig übernommen — niemand verliert Chats.
 */
function migrateLegacyData(target: string): void {
  if (existsSync(target)) return
  const dir = dirname(target)
  const candidates = [
    join(dir, 'hearth.db'),
    join(app.getPath('appData'), 'hearthdesk', 'hearth.db'),
    join(app.getPath('appData'), 'Hearth', 'hearth.db')
  ]
  for (const candidate of candidates) {
    if (candidate === target || !existsSync(candidate)) continue
    copyDatabase(candidate, target)
    log.info('Datenbank übernommen', `${candidate} → ${target}`)
    return
  }
}

/** Sichere Übernahme: erst kopieren, dann prüfen; WAL-Seiten mitnehmen. */
function copyDatabase(from: string, to: string): void {
  copyFileSync(from, to)
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(from + suffix)) copyFileSync(from + suffix, to + suffix)
  }
}

export class Store {
  private db: DatabaseSync
  private closed = false
  readonly path: string
  /** FTS5 ist nicht in jeder SQLite-Kompilierung enthalten → bei Bedarf LIKE. */
  private fts = false

  static open(): Store {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    const target = join(dir, 'hestia.db')
    migrateLegacyData(target)
    return new Store(target)
  }

  constructor(path: string) {
    this.path = path
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 4000')
    this.migrate()
  }

  private migrate(): void {
    const current = asNum(this.db.prepare('PRAGMA user_version').get()?.user_version)
    if (current >= SCHEMA_VERSION) return
    this.db.exec('BEGIN')
    try {
      this.db.exec(BASE_SCHEMA)
      // Stufen der Reihe nach: eine bestehende Datenbank wird hochgezogen,
      // eine neue startet direkt mit der letzten Stufe.
      for (const [version, sql] of Object.entries(MIGRATIONS)) {
        if (current >= Number(version)) continue
        this.db.exec(sql)
      }
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    this.db.exec('COMMIT')
    log.info('Datenbank migriert', `${current} → ${SCHEMA_VERSION}`)
  }

  get isClosed(): boolean {
    return this.closed
  }

  /** Wirft eine benannte, abfangbare Meldung statt des Rohfehler-Textes. */
  private guard(): void {
    if (this.closed) throw new Error('Die Datenbank ist bereits geschlossen')
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      this.db.close()
    } catch (e) {
      log.warn('Shutdown der Datenbank fehlgeschlagen', (e as Error).message)
    }
  }

  // ---------------------------------------------------------------- settings
  getSetting<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as Row | undefined
    return row ? parseJson<T>(row.value, undefined as T) : undefined
  }
  setSetting(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value))
  }

  // ---------------------------------------------------------------- projects
  listProjects(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as Row[]
    return rows.map(rowToProject)
  }
  createProject(input: { name: string; folder?: string; instructions?: string }): Project {
    const now = Date.now()
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      folder: input.folder,
      instructions: input.instructions,
      pinned: false,
      createdAt: now,
      updatedAt: now
    }
    this.db
      .prepare('INSERT INTO projects (id, name, folder, instructions, pinned, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(project.id, project.name, project.folder ?? null, project.instructions ?? null, 0, now, now)
    return project
  }
  updateProject(id: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>): Project | undefined {
    const existing = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined
    if (!existing) return undefined
    const next = { ...rowToProject(existing), ...patch, updatedAt: Date.now() }
    // Ein leerer Ordner heißt: keiner (über den Fernzugang geht `undefined` verloren).
    if (!next.folder) next.folder = undefined
    this.db
      // permission_mode stand hier nicht mit drin — die Stufe eines Projekts
      // ließ sich setzen, wurde aber nie gespeichert.
      .prepare('UPDATE projects SET name=?, folder=?, instructions=?, pinned=?, permission_mode=?, updated_at=? WHERE id=?')
      .run(next.name, next.folder || null, next.instructions ?? null, next.pinned ? 1 : 0, next.permissionMode ?? null, next.updatedAt, id)
    return next
  }
  deleteProject(id: string): void {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
      this.db.prepare('DELETE FROM erinnerungen WHERE project_id = ?').run(id)
      this.db.prepare('DELETE FROM projekt_abschnitte WHERE project_id = ?').run(id)
      this.db.prepare('DELETE FROM projekt_dateien WHERE project_id = ?').run(id)
      // Geplante Aufträge laufen ohne Projekt weiter — mit dem toten Bezug
      // scheiterte sonst jeder Lauf an der Fremdschlüssel-Regel.
      this.db.prepare('UPDATE planned SET project_id = NULL WHERE project_id = ?').run(id)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  // --------------------------------------------------------------- Gedächtnis
  /** Erinnerungen eines Speichers: `projectId` leer heißt der allgemeine. */
  listErinnerungen(projectId?: string): Erinnerung[] {
    this.guard()
    const rows = projectId
      ? this.db.prepare('SELECT * FROM erinnerungen WHERE project_id = ? ORDER BY thema, updated_at DESC').all(projectId)
      : this.db.prepare('SELECT * FROM erinnerungen WHERE project_id IS NULL ORDER BY thema, updated_at DESC').all()
    return (rows as Row[]).map(rowToErinnerung)
  }
  getErinnerung(id: string): Erinnerung | undefined {
    const row = this.db.prepare('SELECT * FROM erinnerungen WHERE id = ?').get(id) as Row | undefined
    return row ? rowToErinnerung(row) : undefined
  }
  addErinnerung(input: { projectId?: string; thema: string; text: string; chatId?: string }): Erinnerung {
    this.guard()
    const now = Date.now()
    const eintrag: Erinnerung = {
      id: randomUUID(),
      projectId: input.projectId,
      thema: input.thema.trim() || 'Allgemein',
      text: input.text.trim(),
      chatId: input.chatId,
      createdAt: now,
      updatedAt: now
    }
    this.db
      .prepare('INSERT INTO erinnerungen (id, project_id, thema, text, chat_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(eintrag.id, eintrag.projectId ?? null, eintrag.thema, eintrag.text, eintrag.chatId ?? null, now, now)
    return eintrag
  }
  updateErinnerung(id: string, patch: { thema?: string; text?: string }): Erinnerung | undefined {
    this.guard()
    const bisher = this.getErinnerung(id)
    if (!bisher) return undefined
    const next: Erinnerung = {
      ...bisher,
      thema: patch.thema?.trim() || bisher.thema,
      text: patch.text?.trim() || bisher.text,
      updatedAt: Date.now()
    }
    this.db.prepare('UPDATE erinnerungen SET thema=?, text=?, updated_at=? WHERE id=?').run(next.thema, next.text, next.updatedAt, id)
    return next
  }
  deleteErinnerung(id: string): void {
    this.guard()
    this.db.prepare('DELETE FROM erinnerungen WHERE id = ?').run(id)
  }
  /** Einen ganzen Speicher leeren. */
  clearErinnerungen(projectId?: string): void {
    this.guard()
    if (projectId) this.db.prepare('DELETE FROM erinnerungen WHERE project_id = ?').run(projectId)
    else this.db.prepare('DELETE FROM erinnerungen WHERE project_id IS NULL').run()
  }

  // --------------------------------------------------------------- Dokumente
  /** Ein Dokument anlegen oder — gleicher Pfad — als neue Fassung fortschreiben. */
  speichereDokument(input: Omit<GespeichertesDokument, 'id' | 'version' | 'createdAt' | 'updatedAt'>): GespeichertesDokument {
    this.guard()
    const vorhanden = this.dokumentNachPfad(input.pfad)
    if (vorhanden) return this.aktualisiereDokument(vorhanden.id, input)!
    const now = Date.now()
    const dok: GespeichertesDokument = { ...input, id: randomUUID(), version: 1, createdAt: now, updatedAt: now }
    this.db
      .prepare(
        `INSERT INTO dokumente (id, chat_id, project_id, pfad, art, titel, untertitel, markdown, gestaltung, version, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(dok.id, dok.chatId ?? null, dok.projectId ?? null, dok.pfad, dok.art, dok.titel, dok.untertitel ?? null, dok.markdown,
        dok.gestaltung ? JSON.stringify(dok.gestaltung) : null, 1, now, now)
    return dok
  }
  /** Neue Fassung: die bisherige wandert in die Versionen. */
  aktualisiereDokument(id: string, patch: Partial<Omit<GespeichertesDokument, 'id' | 'version' | 'createdAt'>>): GespeichertesDokument | undefined {
    this.guard()
    const bisher = this.dokument(id)
    if (!bisher) return undefined
    const next: GespeichertesDokument = { ...bisher, ...patch, id, version: bisher.version + 1, updatedAt: Date.now() }
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare('INSERT OR REPLACE INTO dokument_versionen (dokument_id, version, titel, untertitel, markdown, gestaltung, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, bisher.version, bisher.titel, bisher.untertitel ?? null, bisher.markdown, bisher.gestaltung ? JSON.stringify(bisher.gestaltung) : null, bisher.updatedAt)
      this.db
        .prepare('UPDATE dokumente SET chat_id=?, project_id=?, pfad=?, art=?, titel=?, untertitel=?, markdown=?, gestaltung=?, version=?, updated_at=? WHERE id=?')
        .run(next.chatId ?? null, next.projectId ?? null, next.pfad, next.art, next.titel, next.untertitel ?? null, next.markdown,
          next.gestaltung ? JSON.stringify(next.gestaltung) : null, next.version, next.updatedAt, id)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return next
  }
  dokument(id: string): GespeichertesDokument | undefined {
    const row = this.db.prepare('SELECT * FROM dokumente WHERE id = ?').get(id) as Row | undefined
    return row ? rowToDokument(row) : undefined
  }
  dokumentNachPfad(pfad: string): GespeichertesDokument | undefined {
    const row = this.db.prepare('SELECT * FROM dokumente WHERE pfad = ? ORDER BY updated_at DESC LIMIT 1').get(pfad) as Row | undefined
    return row ? rowToDokument(row) : undefined
  }
  /** Die Dokumente eines Chats und — gehört er zu einem Projekt — die des Projekts. */
  dokumenteFuer(chatId: string, projectId?: string, hoechstens = 30): GespeichertesDokument[] {
    this.guard()
    const rows = projectId
      ? this.db.prepare('SELECT * FROM dokumente WHERE chat_id = ? OR project_id = ? ORDER BY updated_at DESC LIMIT ?').all(chatId, projectId, hoechstens)
      : this.db.prepare('SELECT * FROM dokumente WHERE chat_id = ? ORDER BY updated_at DESC LIMIT ?').all(chatId, hoechstens)
    return (rows as Row[]).map(rowToDokument)
  }
  dokumentVersion(id: string, version: number): Pick<GespeichertesDokument, 'titel' | 'untertitel' | 'markdown' | 'gestaltung'> | undefined {
    const row = this.db.prepare('SELECT * FROM dokument_versionen WHERE dokument_id = ? AND version = ?').get(id, version) as Row | undefined
    if (!row) return undefined
    return {
      titel: asText(row.titel),
      untertitel: typeof row.untertitel === 'string' ? row.untertitel : undefined,
      markdown: asText(row.markdown),
      gestaltung: parseJson<Gestaltung | undefined>(row.gestaltung, undefined)
    }
  }
  dokumentVersionen(id: string): number[] {
    const rows = this.db.prepare('SELECT version FROM dokument_versionen WHERE dokument_id = ? ORDER BY version').all(id) as Row[]
    return rows.map((r) => asNum(r.version))
  }

  // ---------------------------------------------------------- Projekt-Kontext
  listProjektDateien(projectId: string): ProjektDatei[] {
    this.guard()
    const rows = this.db
      .prepare('SELECT id, project_id, name, art, groesse, zeichen, created_at FROM projekt_dateien WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as Row[]
    return rows.map(rowToProjektDatei)
  }
  /** Dateien mit ihrem Text — für den Prompt. */
  projektTexte(projectId: string): { name: string; text: string }[] {
    this.guard()
    const rows = this.db.prepare('SELECT name, text FROM projekt_dateien WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as Row[]
    return rows.map((r) => ({ name: asText(r.name), text: asText(r.text) }))
  }
  projektZeichen(projectId: string): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(zeichen), 0) AS summe FROM projekt_dateien WHERE project_id = ?').get(projectId) as Row | undefined
    return asNum(row?.summe)
  }
  addProjektDatei(input: { projectId: string; name: string; art: string; groesse: number; text: string }): ProjektDatei {
    this.guard()
    const datei: ProjektDatei = {
      id: randomUUID(),
      projectId: input.projectId,
      name: input.name,
      art: input.art,
      groesse: input.groesse,
      zeichen: input.text.length,
      createdAt: Date.now()
    }
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare('INSERT INTO projekt_dateien (id, project_id, name, art, groesse, zeichen, text, created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(datei.id, datei.projectId, datei.name, datei.art, datei.groesse, datei.zeichen, input.text, datei.createdAt)
      const eintragen = this.db.prepare('INSERT INTO projekt_abschnitte (text, datei_id, project_id, nr) VALUES (?,?,?,?)')
      abschnitte(input.text).forEach((stueck, nr) => eintragen.run(stueck, datei.id, datei.projectId, nr))
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return datei
  }
  deleteProjektDatei(id: string): void {
    this.guard()
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM projekt_abschnitte WHERE datei_id = ?').run(id)
      this.db.prepare('DELETE FROM projekt_dateien WHERE id = ?').run(id)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
  /** Volltextsuche in den Kontextdateien eines Projekts, beste Treffer zuerst. */
  sucheImProjekt(projectId: string, anfrage: string, hoechstens = 6): { datei: string; text: string }[] {
    this.guard()
    const fts = ftsAnfrage(anfrage)
    if (!fts) return []
    const rows = this.db
      .prepare(
        `SELECT a.text AS text, d.name AS datei
           FROM projekt_abschnitte a JOIN projekt_dateien d ON d.id = a.datei_id
          WHERE projekt_abschnitte MATCH ? AND a.project_id = ?
          ORDER BY bm25(projekt_abschnitte) LIMIT ?`
      )
      .all(fts, projectId, hoechstens) as Row[]
    return rows.map((r) => ({ datei: asText(r.datei), text: asText(r.text) }))
  }
  /** Den Text einer Kontextdatei — ab einer Stelle, höchstens `laenge` Zeichen. */
  projektDateiText(projectId: string, name: string, ab = 0, laenge = 12_000): { name: string; text: string; gesamt: number } | undefined {
    this.guard()
    const rows = this.db.prepare('SELECT name, text FROM projekt_dateien WHERE project_id = ?').all(projectId) as Row[]
    const gesucht = name.trim().toLowerCase()
    const row = rows.find((r) => asText(r.name).toLowerCase() === gesucht) ?? rows.find((r) => asText(r.name).toLowerCase().includes(gesucht))
    if (!row) return undefined
    const text = asText(row.text)
    return { name: asText(row.name), text: text.slice(Math.max(0, ab), Math.max(0, ab) + laenge), gesamt: text.length }
  }

  // -------------------------------------------------------------------- chats
  listChats(): Chat[] {
    const rows = this.db
      .prepare('SELECT * FROM chats ORDER BY pinned DESC, updated_at DESC LIMIT 500')
      .all() as Row[]
    return rows.map(rowToChat)
  }
  getChat(id: string): Chat | undefined {
    const row = this.db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as Row | undefined
    return row ? rowToChat(row) : undefined
  }
  createChat(input: {
    mode: ChatMode
    title?: string
    projectId?: string
    folder?: string
    model?: string
    permissionMode?: PermissionMode
  }): Chat {
    const now = Date.now()
    const chat: Chat = {
      id: randomUUID(),
      title: input.title?.trim() || 'Neuer Chat',
      mode: input.mode,
      projectId: input.projectId,
      folder: input.folder,
      permissionMode: input.permissionMode,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      model: input.model
    }
    this.db
      .prepare(
        'INSERT INTO chats (id, title, mode, project_id, folder, permission_mode, pinned, created_at, updated_at, model) VALUES (?,?,?,?,?,?,?,?,?,?)'
      )
      .run(
        chat.id,
        chat.title,
        chat.mode,
        chat.projectId ?? null,
        chat.folder ?? null,
        chat.permissionMode ?? null,
        0,
        now,
        now,
        chat.model ?? null
      )
    return chat
  }
  touchChat(id: string, patch: { title?: string; model?: string } = {}): void {
    this.guard()
    const chat = this.getChat(id)
    if (!chat) return
    this.db
      .prepare('UPDATE chats SET title=?, model=?, updated_at=? WHERE id=?')
      .run(patch.title ?? chat.title, patch.model ?? chat.model ?? null, Date.now(), id)
  }
  renameChat(id: string, title: string): Chat | undefined {
    this.db.prepare('UPDATE chats SET title=?, updated_at=? WHERE id=?').run(title.trim() || 'Neuer Chat', Date.now(), id)
    return this.getChat(id)
  }
  /** Das gewählte Modell merken, ohne den Chat in der Liste nach oben zu schieben. */
  setChatModel(id: string, model: string): void {
    this.guard()
    this.db.prepare('UPDATE chats SET model=? WHERE id=?').run(model, id)
  }
  pinChat(id: string, pinned: boolean): Chat | undefined {
    this.db.prepare('UPDATE chats SET pinned=? WHERE id=?').run(pinned ? 1 : 0, id)
    return this.getChat(id)
  }
  setChatPermission(id: string, permissionMode: PermissionMode): Chat | undefined {
    this.guard()
    this.db.prepare('UPDATE chats SET permission_mode=?, updated_at=? WHERE id=?').run(permissionMode, Date.now(), id)
    return this.getChat(id)
  }
  setChatMode(id: string, mode: ChatMode, folder?: string): Chat | undefined {
    const chat = this.getChat(id)
    if (!chat) return undefined
    this.db
      .prepare('UPDATE chats SET mode=?, folder=?, updated_at=? WHERE id=?')
      .run(mode, folder ?? chat.folder ?? null, Date.now(), id)
    return this.getChat(id)
  }
  deleteChat(id: string): void {
    this.db.prepare('DELETE FROM messages WHERE chat_id = ?').run(id)
    if (this.fts) this.db.prepare('DELETE FROM messages_fts WHERE chat_id = ?').run(id)
    this.db.prepare('DELETE FROM chats WHERE id = ?').run(id)
  }

  // ----------------------------------------------------------------- messages
  /**
   * Der gültige Zweig eines Chats, von der ersten Nachricht bis zum Blatt —
   * jede mit ihrem Fassungszähler. Andere Zweige bleiben gespeichert und sind
   * über den Zähler (‹ 2/3 ›) erreichbar.
   */
  listMessages(chatId: string): Message[] {
    const alle = (this.db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC, rowid ASC').all(chatId) as Row[]).map(rowToMessage)
    if (alle.length === 0) return []
    const nachId = new Map(alle.map((m) => [m.id, m]))
    const kinder = new Map<string, Message[]>()
    for (const m of alle) {
      const schluessel = m.parentId && nachId.has(m.parentId) ? m.parentId : ''
      kinder.set(schluessel, [...(kinder.get(schluessel) ?? []), m])
    }
    const blattRow = this.db.prepare('SELECT blatt_id FROM chats WHERE id = ?').get(chatId) as Row | undefined
    let blatt = typeof blattRow?.blatt_id === 'string' ? nachId.get(blattRow.blatt_id) : undefined
    if (!blatt) blatt = alle[alle.length - 1]!
    const pfad: Message[] = []
    const gesehen = new Set<string>()
    for (let m: Message | undefined = blatt; m && !gesehen.has(m.id); m = m.parentId ? nachId.get(m.parentId) : undefined) {
      gesehen.add(m.id)
      pfad.unshift(m)
    }
    return pfad.map((m) => {
      const schwestern = kinder.get(m.parentId && nachId.has(m.parentId) ? m.parentId : '') ?? [m]
      return { ...m, zweig: { index: schwestern.findIndex((s) => s.id === m.id) + 1, anzahl: schwestern.length } }
    })
  }
  /** Der Zweig von der ersten Nachricht bis zu dieser (ohne Blick aufs Blatt). */
  pfadBis(id: string): Message[] {
    const ziel = this.getMessage(id)
    if (!ziel) return []
    const alle = new Map(
      (this.db.prepare('SELECT * FROM messages WHERE chat_id = ?').all(ziel.chatId) as Row[]).map((r) => [asText(r.id), rowToMessage(r)])
    )
    const pfad: Message[] = []
    const gesehen = new Set<string>()
    for (let m: Message | undefined = alle.get(id); m && !gesehen.has(m.id); m = m.parentId ? alle.get(m.parentId) : undefined) {
      gesehen.add(m.id)
      pfad.unshift(m)
    }
    return pfad
  }
  getMessage(id: string): Message | undefined {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row | undefined
    return row ? rowToMessage(row) : undefined
  }
  /** Die Schwestern einer Nachricht (gleiche Vorgängerin), älteste zuerst. */
  schwestern(id: string): Message[] {
    const m = this.getMessage(id)
    if (!m) return []
    const rows = m.parentId
      ? this.db.prepare('SELECT * FROM messages WHERE chat_id = ? AND parent_id = ? ORDER BY created_at ASC, rowid ASC').all(m.chatId, m.parentId)
      : this.db.prepare('SELECT * FROM messages WHERE chat_id = ? AND parent_id IS NULL ORDER BY created_at ASC, rowid ASC').all(m.chatId)
    return (rows as Row[]).map(rowToMessage)
  }
  /** Den gültigen Zweig umstellen: dieses Blatt ist jetzt das Ende des Gesprächs. */
  setzeBlatt(chatId: string, messageId: string | null): void {
    this.db.prepare('UPDATE chats SET blatt_id = ? WHERE id = ?').run(messageId, chatId)
  }
  /** Von einer Nachricht aus immer der jüngsten Fortsetzung folgen — dort endet ihr Zweig. */
  blattUnter(id: string): string {
    let aktuell = id
    for (let schritt = 0; schritt < 10_000; schritt++) {
      const kind = this.db.prepare('SELECT id FROM messages WHERE parent_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(aktuell) as Row | undefined
      if (!kind || typeof kind.id !== 'string') break
      aktuell = kind.id
    }
    return aktuell
  }
  /**
   * Eine Nachricht anhängen — an `parentId`, sonst an das Blatt des Chats — und
   * sie zum neuen Blatt machen.
   */
  insertMessage(message: Message, eltern?: string | null): Message {
    this.guard()
    // eltern: undefined = ans Blatt, null = an die Wurzel (erste Frage bearbeitet), sonst diese.
    let parentId = eltern === null ? undefined : (eltern ?? message.parentId)
    if (eltern === undefined && parentId === undefined) {
      const blatt = this.db.prepare('SELECT blatt_id FROM chats WHERE id = ?').get(message.chatId) as Row | undefined
      parentId = typeof blatt?.blatt_id === 'string' ? blatt.blatt_id : undefined
    }
    this.db
      .prepare('INSERT INTO messages (id, chat_id, role, parts, created_at, usage, error, parent_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(
        message.id,
        message.chatId,
        message.role,
        JSON.stringify(message.parts),
        message.createdAt,
        message.usage ? JSON.stringify(message.usage) : null,
        message.error ?? null,
        parentId ?? null
      )
    this.setzeBlatt(message.chatId, message.id)
    this.indexMessage(message)
    return { ...message, parentId }
  }
  updateMessage(id: string, patch: { parts?: Message['parts']; usage?: Message['usage']; error?: string }): void {
    this.guard()
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row | undefined
    if (!row) return
    const current = rowToMessage(row)
    this.db
      .prepare('UPDATE messages SET parts=?, usage=?, error=? WHERE id=?')
      .run(
        JSON.stringify(patch.parts ?? current.parts),
        JSON.stringify(patch.usage ?? current.usage ?? null),
        patch.error ?? current.error ?? null,
        id
      )
    const updated = { ...current, ...(patch.parts ? { parts: patch.parts } : {}) }
    this.indexMessage(updated)
  }
  private indexMessage(message: Message): void {
    if (!this.fts) return
    const body = message.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
    this.db.prepare('DELETE FROM messages_fts WHERE message_id = ?').run(message.id)
    if (body) {
      this.db
        .prepare('INSERT INTO messages_fts (body, chat_id, message_id) VALUES (?,?,?)')
        .run(body, message.chatId, message.id)
    }
  }
  searchMessages(query: string, limit = 20): { chatId: string; messageId: string }[] {
    const q = query.trim()
    if (!q) return []
    if (this.fts) {
      try {
        const rows = this.db
          .prepare(
            'SELECT chat_id, message_id FROM messages_fts WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?'
          )
          .all(`"${q.replace(/"/g, '""')}"*`, limit) as Row[]
        return rows.map((r) => ({ chatId: asText(r.chat_id), messageId: asText(r.message_id) }))
      } catch (e) {
        log.warn('FTS-Suche fehlgeschlagen, LIKE-Fallback', (e as Error).message)
      }
    }
    const rows = this.db
      .prepare('SELECT chat_id, id AS message_id FROM messages WHERE parts LIKE ? ORDER BY created_at DESC LIMIT ?')
      .all(`%${q}%`, limit) as Row[]
    return rows.map((r) => ({ chatId: asText(r.chat_id), messageId: asText(r.message_id) }))
  }

  // ------------------------------------------------ Frühere Chats (Werkzeuge)
  /**
   * Frühere Chats nach Stichwörtern durchsuchen — im selben Bereich wie der
   * fragende Chat: im Projekt nur dessen Chats, sonst nur Chats ohne Projekt.
   * Gewertet wird am echten Nachrichtentext (nicht am gespeicherten JSON):
   * je mehr verschiedene Suchwörter eine Nachricht enthält, desto weiter oben.
   */
  sucheInChats(
    anfrage: string,
    bereich: { projectId?: string; ausser?: string; seit?: number; bis?: number; hoechstens?: number }
  ): { chatId: string; titel: string; zuletzt: number; auszuege: { rolle: string; text: string; zeit: number }[] }[] {
    this.guard()
    const woerter = [...new Set(anfrage.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !FUELLWOERTER.has(w)))].slice(0, 8)
    if (woerter.length === 0) return []
    const bedingungen = [bereich.projectId ? 'c.project_id = ?' : 'c.project_id IS NULL', 'm.chat_id != ?', 'm.created_at >= ?', 'm.created_at <= ?']
    const werte: (string | number)[] = [...(bereich.projectId ? [bereich.projectId] : []), bereich.ausser ?? '', bereich.seit ?? 0, bereich.bis ?? Number.MAX_SAFE_INTEGER]
    const rows = this.db
      .prepare(
        `SELECT m.chat_id AS chat_id, m.role AS role, m.parts AS parts, m.created_at AS created_at, c.title AS title, c.updated_at AS updated_at
           FROM messages m JOIN chats c ON c.id = m.chat_id
          WHERE ${bedingungen.join(' AND ')} AND (${woerter.map(() => '(m.parts LIKE ? OR m.parts LIKE ? OR m.parts LIKE ?)').join(' OR ')})
          ORDER BY m.created_at DESC LIMIT 600`
      )
      .all(...werte, ...woerter.flatMap((w) => [`%${w}%`, `%${w.charAt(0).toUpperCase()}${w.slice(1)}%`, `%${w.toUpperCase()}%`])) as Row[]

    const chats = new Map<string, { titel: string; zuletzt: number; punkte: number; treffer: { punkte: number; rolle: string; text: string; zeit: number }[] }>()
    for (const r of rows) {
      const text = parseJson<Message['parts']>(r.parts, [])
        .map((p) => (p.type === 'text' ? p.text : p.type === 'file' ? `[Datei ${p.name}]` : ''))
        .join('\n')
      const klein = text.toLowerCase()
      const gefunden = woerter.filter((w) => klein.includes(w))
      if (gefunden.length === 0) continue
      const chatId = asText(r.chat_id)
      const eintrag = chats.get(chatId) ?? { titel: asText(r.title), zuletzt: asNum(r.updated_at), punkte: 0, treffer: [] }
      eintrag.punkte = Math.max(eintrag.punkte, gefunden.length) + eintrag.treffer.length * 0.01
      const stelle = Math.max(0, klein.indexOf(gefunden[0]!) - 250)
      const auszug = `${stelle > 0 ? '…' : ''}${text.slice(stelle, stelle + 700).trim()}${stelle + 700 < text.length ? '…' : ''}`
      eintrag.treffer.push({ punkte: gefunden.length, rolle: asText(r.role), text: auszug, zeit: asNum(r.created_at) })
      chats.set(chatId, eintrag)
    }
    return [...chats.entries()]
      .sort((a, b) => b[1].punkte - a[1].punkte || b[1].zuletzt - a[1].zuletzt)
      .slice(0, bereich.hoechstens ?? 5)
      .map(([chatId, e]) => ({
        chatId,
        titel: e.titel,
        zuletzt: e.zuletzt,
        auszuege: e.treffer
          .sort((a, b) => b.punkte - a.punkte)
          .slice(0, 3)
          .sort((a, b) => a.zeit - b.zeit)
          .map(({ rolle, text, zeit }) => ({ rolle, text, zeit }))
      }))
  }

  /** Die jüngsten Chats im selben Bereich, mit erster Frage und letzter Antwort. */
  letzteChats(bereich: { projectId?: string; ausser?: string; seit?: number; bis?: number; anzahl?: number }): {
    chatId: string
    titel: string
    zuletzt: number
    frage: string
    antwort: string
  }[] {
    this.guard()
    const rows = this.db
      .prepare(
        `SELECT id, title, updated_at FROM chats
          WHERE ${bereich.projectId ? 'project_id = ?' : 'project_id IS NULL'} AND id != ? AND updated_at >= ? AND updated_at <= ?
            AND EXISTS (SELECT 1 FROM messages WHERE chat_id = chats.id)
          ORDER BY updated_at DESC, rowid DESC LIMIT ?`
      )
      .all(...(bereich.projectId ? [bereich.projectId] : []), bereich.ausser ?? '', bereich.seit ?? 0, bereich.bis ?? Number.MAX_SAFE_INTEGER, Math.min(20, Math.max(1, bereich.anzahl ?? 8))) as Row[]
    const textVon = (roh: unknown): string =>
      parseJson<Message['parts']>(roh, [])
        .filter((p) => p.type === 'text')
        .map((p) => (p as { text: string }).text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    return rows.map((r) => {
      const id = asText(r.id)
      const erste = this.db.prepare("SELECT parts FROM messages WHERE chat_id = ? AND role = 'user' ORDER BY created_at ASC LIMIT 1").get(id) as Row | undefined
      const letzte = this.db.prepare("SELECT parts FROM messages WHERE chat_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1").get(id) as Row | undefined
      return { chatId: id, titel: asText(r.title), zuletzt: asNum(r.updated_at), frage: textVon(erste?.parts).slice(0, 200), antwort: textVon(letzte?.parts).slice(0, 300) }
    })
  }

  // --------------------------------------------------------------- artefakte
  listArtifacts(): Artifact[] {
    const rows = this.db.prepare('SELECT * FROM artifacts ORDER BY pinned DESC, updated_at DESC').all() as Row[]
    return rows.map(rowToArtifact)
  }
  getArtifact(id: string): Artifact | undefined {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as Row | undefined
    return row ? rowToArtifact(row) : undefined
  }
  createArtifact(input: { title: string; kind: Artifact['kind']; body: string; chatId?: string }): Artifact {
    const now = Date.now()
    const artifact: Artifact = {
      id: randomUUID(),
      title: input.title,
      kind: input.kind,
      body: input.body,
      chatId: input.chatId,
      pinned: false,
      createdAt: now,
      updatedAt: now
    }
    this.db
      .prepare('INSERT INTO artifacts (id, title, kind, body, chat_id, pinned, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(artifact.id, artifact.title, artifact.kind, artifact.body, artifact.chatId ?? null, 0, now, now)
    return artifact
  }
  updateArtifact(id: string, patch: Partial<Pick<Artifact, 'title' | 'body' | 'pinned'>>): Artifact | undefined {
    const existing = this.getArtifact(id)
    if (!existing) return undefined
    const next: Artifact = { ...existing, ...patch, updatedAt: Date.now() }
    this.db
      .prepare('UPDATE artifacts SET title=?, body=?, pinned=?, updated_at=? WHERE id=?')
      .run(next.title, next.body, next.pinned ? 1 : 0, next.updatedAt, id)
    return next
  }
  // ------------------------------------------------------------- Geplante Aufträge
  listPlanned(): PlannedTask[] {
    this.guard()
    const rows = this.db.prepare('SELECT * FROM planned ORDER BY next_run_at = 0, next_run_at ASC, updated_at DESC').all() as Row[]
    return rows.map(rowToPlanned)
  }

  createPlanned(input: {
    title: string
    prompt: string
    mode: ChatMode
    folder?: string
    model?: string
    projectId?: string
    schedule: Schedule
    enabled?: boolean
    nextRunAt: number
  }): PlannedTask {
    this.guard()
    const now = Date.now()
    const task: PlannedTask = {
      id: randomUUID(),
      title: input.title.trim() || 'Geplanter Auftrag',
      prompt: input.prompt,
      mode: input.mode,
      folder: input.folder,
      model: input.model,
      projectId: input.projectId,
      schedule: input.schedule,
      enabled: input.enabled ?? true,
      nextRunAt: input.nextRunAt,
      createdAt: now,
      updatedAt: now
    }
    this.db
      .prepare(
        `INSERT INTO planned (id, title, prompt, mode, folder, model, project_id, schedule, enabled, next_run_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        task.id,
        task.title,
        task.prompt,
        task.mode,
        task.folder ?? null,
        task.model ?? null,
        task.projectId ?? null,
        JSON.stringify(task.schedule),
        task.enabled ? 1 : 0,
        task.nextRunAt,
        now,
        now
      )
    return task
  }

  updatePlanned(
    id: string,
    patch: Partial<Pick<PlannedTask, 'title' | 'prompt' | 'mode' | 'folder' | 'model' | 'schedule' | 'enabled' | 'nextRunAt'>>
  ): PlannedTask | undefined {
    this.guard()
    const existing = this.getPlanned(id)
    if (!existing) return undefined
    const next: PlannedTask = { ...existing, ...patch, updatedAt: Date.now() }
    this.db
      .prepare(
        `UPDATE planned SET title=?, prompt=?, mode=?, folder=?, model=?, schedule=?, enabled=?, next_run_at=?, updated_at=? WHERE id=?`
      )
      .run(
        next.title,
        next.prompt,
        next.mode,
        next.folder ?? null,
        next.model ?? null,
        JSON.stringify(next.schedule),
        next.enabled ? 1 : 0,
        next.nextRunAt,
        next.updatedAt,
        id
      )
    return next
  }

  getPlanned(id: string): PlannedTask | undefined {
    this.guard()
    const row = this.db.prepare('SELECT * FROM planned WHERE id = ?').get(id) as Row | undefined
    return row ? rowToPlanned(row) : undefined
  }

  /** Notiert einen gelaufenen Auftrag mitsamt Ergebnis. */
  recordPlannedRun(id: string, run: { at: number; chatId?: string; error?: string; nextRunAt: number }): void {
    this.guard()
    this.db
      .prepare('UPDATE planned SET last_run_at=?, last_chat_id=?, last_error=?, next_run_at=?, updated_at=? WHERE id=?')
      .run(run.at, run.chatId ?? null, run.error ?? null, run.nextRunAt, Date.now(), id)
  }

  deletePlanned(id: string): void {
    this.guard()
    this.db.prepare('DELETE FROM planned WHERE id = ?').run(id)
  }

  deleteArtifact(id: string): void {
    this.db.prepare('DELETE FROM artifacts WHERE id = ?').run(id)
  }

  // ---------------------------------------------------------------- providers
  listProviders(): ProviderConfig[] {
    const rows = this.db.prepare('SELECT * FROM providers ORDER BY rowid ASC').all() as Row[]
    return rows.map(rowToProvider)
  }
  upsertProvider(provider: ProviderConfig, hasKey: boolean): ProviderConfig {
    this.db
      .prepare(
        `INSERT INTO providers (id, label, kind, base_url, enabled, has_key) VALUES (?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET label=excluded.label, kind=excluded.kind, base_url=excluded.base_url,
           enabled=excluded.enabled, has_key=excluded.has_key`
      )
      .run(provider.id, provider.label, provider.kind, provider.baseUrl, provider.enabled ? 1 : 0, hasKey ? 1 : 0)
    return { ...provider, hasKey }
  }
  deleteProvider(id: string): void {
    this.db.prepare('DELETE FROM providers WHERE id = ?').run(id)
  }
}
