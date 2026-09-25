import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Store } from '../../src/main/db'
import type { Message } from '@shared/types'

let dir = ''
let store: Store

function message(chatId: string, text: string): Message {
  return { id: crypto.randomUUID(), chatId, role: 'user', parts: [{ type: 'text', text }], createdAt: Date.now() }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hearth-db-'))
  store = new Store(join(dir, 'test.db'))
})

afterEach(async () => {
  store.close()
  await rm(dir, { recursive: true, force: true })
})

describe('Migration', () => {
  it('hebt eine Datenbank mit Stand 1 auf die heutige Stufe', () => {
    const file = join(dir, 'alt.db')
    const raw = new DatabaseSync(file)
    // absichtlich unvollständig: so sah die Datenbank vor den Artifacts aus
    raw.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, folder TEXT, instructions TEXT,
        pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT NOT NULL,
        project_id TEXT, folder TEXT, pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, model TEXT);
      CREATE TABLE messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL,
        parts TEXT NOT NULL, created_at INTEGER NOT NULL, usage TEXT, error TEXT);
      CREATE TABLE providers (id TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL,
        base_url TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, has_key INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version = 1;
    `)
    raw.close()

    const migrated = new Store(file)
    expect(migrated.listArtifacts()).toEqual([])
    const created = migrated.createArtifact({ title: 'Test', kind: 'markdown', body: 'hi' })
    expect(migrated.listArtifacts().map((a) => a.id)).toContain(created.id)
    migrated.close()

    const reopened = new DatabaseSync(file)
    expect(reopened.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 8 })
    // Gedächtnis und Projekt-Kontext (Stufe 5) stehen bereit.
    expect(reopened.prepare('SELECT count(*) AS n FROM erinnerungen').get()).toMatchObject({ n: 0 })
    expect(reopened.prepare('SELECT count(*) AS n FROM projekt_abschnitte').get()).toMatchObject({ n: 0 })
    reopened.prepare('UPDATE planned SET project_id = NULL').run()
    expect(reopened.prepare('SELECT count(*) AS n FROM dokumente').get()).toMatchObject({ n: 0 })
    // Auch die geplanten Aufträge sind da.
    expect(reopened.prepare("SELECT count(*) AS n FROM planned").get()).toMatchObject({ n: 0 })
    // Die neue Zugriffsstufe ist wirklich da und benutzbar.
    reopened.prepare('UPDATE chats SET permission_mode = ? WHERE id = ?').run('everything', 'proben-id')
    reopened.close()
  })
})

describe('Store', () => {
  it('legt Chat an, benennt um und findet ihn wieder', () => {
    const chat = store.createChat({ mode: 'chat' })
    expect(chat.title).toBe('Neuer Chat')

    store.insertMessage(message(chat.id, 'Kürbissuppe für vier'))
    store.renameChat(chat.id, 'Rezeptfrage')

    const found = store.getChat(chat.id)
    expect(found?.title).toBe('Rezeptfrage')
    expect(store.listMessages(chat.id)).toHaveLength(1)
  })

  it('sucht im Nachrichtentext', () => {
    const chat = store.createChat({ mode: 'chat', title: 'Notizen' })
    store.insertMessage(message(chat.id, 'Wichtige Rufnummer für den Installateur'))
    const hits = store.searchMessages('Installateur')
    expect(hits.some((hit) => hit.chatId === chat.id)).toBe(true)
    expect(store.searchMessages('nichts-von-dem-hier')).toHaveLength(0)
  })

  it('löscht Nachrichten mit dem Chat', () => {
    const chat = store.createChat({ mode: 'agent', folder: '/tmp' })
    const msg = message(chat.id, 'text')
    store.insertMessage(msg)
    store.deleteChat(chat.id)
    expect(store.getChat(chat.id)).toBeUndefined()
    expect(store.listMessages(chat.id)).toHaveLength(0)
  })

  it('merkt Einstellungen und Anbieter', () => {
    store.setSetting('theme', 'dark')
    expect(store.getSetting<string>('theme')).toBe('dark')

    const saved = store.upsertProvider(
      { id: 'p1', label: 'Ollama', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', hasKey: false, enabled: true },
      false
    )
    expect(saved.baseUrl).toContain('11434')
    expect(store.listProviders().map((p) => p.id)).toContain('p1')
  })

  it('aktualisiert Nachrichtenteile, ohne andere zu verlieren', () => {
    const chat = store.createChat({ mode: 'chat' })
    const msg = message(chat.id, 'anfang')
    store.insertMessage(msg)
    store.updateMessage(msg.id, { parts: [{ type: 'text', text: 'anfang ende' }] })
    const [stored] = store.listMessages(chat.id)
    expect(stored?.parts).toEqual([{ type: 'text', text: 'anfang ende' }])
  })
})
