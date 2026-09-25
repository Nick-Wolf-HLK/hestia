/**
 * Das Gespräch als Baum: bearbeiten, neu antworten, zwischen Fassungen wechseln.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Store } from '../../src/main/db'
import type { Message } from '@shared/types'

let dir = ''
let store: Store

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hestia-zweige-'))
  store = new Store(join(dir, 'test.db'))
})

afterEach(async () => {
  store.close()
  await rm(dir, { recursive: true, force: true })
})

let uhr = 1_000
function nachricht(chatId: string, role: Message['role'], text: string): Message {
  return { id: crypto.randomUUID(), chatId, role, parts: [{ type: 'text', text }], createdAt: uhr++ }
}
const texte = (liste: Message[]): string[] => liste.map((m) => (m.parts[0] as { text: string }).text)

describe('Gesprächsbaum', () => {
  it('hängt neue Nachrichten ans Blatt und liefert den Zweig mit Zählern', () => {
    const chat = store.createChat({ mode: 'chat' })
    store.insertMessage(nachricht(chat.id, 'user', 'Frage'))
    store.insertMessage(nachricht(chat.id, 'assistant', 'Antwort'))
    const liste = store.listMessages(chat.id)
    expect(texte(liste)).toEqual(['Frage', 'Antwort'])
    expect(liste.map((m) => m.zweig)).toEqual([{ index: 1, anzahl: 1 }, { index: 1, anzahl: 1 }])
    expect(liste[1]!.parentId).toBe(liste[0]!.id)
  })

  it('macht aus einer bearbeiteten Frage eine zweite Fassung — die erste bleibt erreichbar', () => {
    const chat = store.createChat({ mode: 'chat' })
    const f1 = store.insertMessage(nachricht(chat.id, 'user', 'Frage A'))
    store.insertMessage(nachricht(chat.id, 'assistant', 'Antwort A'))
    store.insertMessage(nachricht(chat.id, 'user', 'Folgefrage A'))
    // Bearbeiten der ersten Frage: Schwester an der Wurzel.
    const f2 = store.insertMessage(nachricht(chat.id, 'user', 'Frage B'), null)
    store.insertMessage(nachricht(chat.id, 'assistant', 'Antwort B'))

    const jetzt = store.listMessages(chat.id)
    expect(texte(jetzt)).toEqual(['Frage B', 'Antwort B'])
    expect(jetzt[0]!.zweig).toEqual({ index: 2, anzahl: 2 })

    // Zurück auf Fassung 1: der ganze alte Zweig kommt mit.
    store.setzeBlatt(chat.id, store.blattUnter(f1.id))
    expect(texte(store.listMessages(chat.id))).toEqual(['Frage A', 'Antwort A', 'Folgefrage A'])
    expect(store.schwestern(f2.id).map((m) => m.id)).toEqual([f1.id, f2.id])
  })

  it('hängt eine neu erzeugte Antwort als Schwester an dieselbe Frage', () => {
    const chat = store.createChat({ mode: 'chat' })
    const frage = store.insertMessage(nachricht(chat.id, 'user', 'Frage'))
    store.insertMessage(nachricht(chat.id, 'assistant', 'Erste Antwort'))
    store.setzeBlatt(chat.id, frage.id)
    store.insertMessage(nachricht(chat.id, 'assistant', 'Zweite Antwort'))
    const liste = store.listMessages(chat.id)
    expect(texte(liste)).toEqual(['Frage', 'Zweite Antwort'])
    expect(liste[1]!.zweig).toEqual({ index: 2, anzahl: 2 })
  })

  it('verkettet bestehende Chats bei der Migration zu einer geraden Linie', () => {
    const datei = join(dir, 'alt.db')
    const alt = new Store(datei)
    const chat = alt.createChat({ mode: 'chat' })
    alt.close()
    // So sah es vor Stufe 7 aus: keine Verkettung, kein Blatt.
    const roh = new DatabaseSync(datei)
    roh.exec('PRAGMA user_version = 6')
    roh.exec('DROP INDEX IF EXISTS idx_messages_parent')
    roh.exec('ALTER TABLE messages DROP COLUMN parent_id')
    roh.exec('ALTER TABLE chats DROP COLUMN blatt_id')
    const einfuegen = roh.prepare('INSERT INTO messages (id, chat_id, role, parts, created_at) VALUES (?,?,?,?,?)')
    einfuegen.run('a', chat.id, 'user', JSON.stringify([{ type: 'text', text: 'eins' }]), 1)
    einfuegen.run('b', chat.id, 'assistant', JSON.stringify([{ type: 'text', text: 'zwei' }]), 2)
    einfuegen.run('c', chat.id, 'user', JSON.stringify([{ type: 'text', text: 'drei' }]), 3)
    roh.close()

    const neu = new Store(datei)
    const liste = neu.listMessages(chat.id)
    expect(texte(liste)).toEqual(['eins', 'zwei', 'drei'])
    expect(liste.map((m) => m.parentId)).toEqual([undefined, 'a', 'b'])
    neu.insertMessage(nachricht(chat.id, 'assistant', 'vier'))
    expect(texte(neu.listMessages(chat.id))).toEqual(['eins', 'zwei', 'drei', 'vier'])
    neu.close()
  })
})

describe('Umbenennung des Arbeitsmodus', () => {
  it('zieht alte Cowork-Chats, geplante Aufträge und die Modellvorgabe auf „agent“ um', () => {
    const datei = join(dir, 'modus.db')
    const alt = new Store(datei)
    const chat = alt.createChat({ mode: 'chat' })
    alt.setSetting('settings', { defaultModelCowork: 'p|m', theme: 'system' })
    alt.close()
    const roh = new DatabaseSync(datei)
    roh.exec(`UPDATE chats SET mode = 'cowork' WHERE id = '${chat.id}'`)
    roh.exec('PRAGMA user_version = 7')
    roh.close()

    const neu = new Store(datei)
    expect(neu.getChat(chat.id)?.mode).toBe('agent')
    expect(neu.getSetting<Record<string, unknown>>('settings')).toEqual({ defaultModelAgent: 'p|m', theme: 'system' })
    neu.close()
  })
})
