/**
 * Frühere Chats durchsuchen: Bereich (Projekt oder nicht), Wertung, Zeitraum.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../src/main/db'
import { mitVerlauf } from '../../src/main/verlauf'
import { DEFAULT_SETTINGS, type Message } from '@shared/types'

let dir = ''
let store: Store
let uhr = Date.now() - 10_000

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hestia-verlauf-'))
  store = new Store(join(dir, 'test.db'))
})

afterEach(async () => {
  store.close()
  await rm(dir, { recursive: true, force: true })
})

function gespraech(titel: string, zeilen: [Message['role'], string][], projectId?: string): string {
  const chat = store.createChat({ mode: 'chat', title: titel, projectId })
  for (const [role, text] of zeilen) store.insertMessage({ id: crypto.randomUUID(), chatId: chat.id, role, parts: [{ type: 'text', text }], createdAt: uhr++ })
  return chat.id
}

describe('Frühere Chats', () => {
  it('findet den passenden Chat, wertet nach Treffern und lässt den fragenden Chat aus', () => {
    gespraech('Urlaub', [['user', 'Wir fahren im Mai nach Lissabon.'], ['assistant', 'Lissabon im Mai ist herrlich.']])
    gespraech('Kochen', [['user', 'Rezept für Linsensuppe?'], ['assistant', 'Linsen, Karotten, Brühe.']])
    const jetzt = gespraech('Heute', [['user', 'Wohin fahren wir im Mai?']])
    const treffer = store.sucheInChats('Mai Lissabon Reise', { ausser: jetzt })
    expect(treffer.map((t) => t.titel)).toEqual(['Urlaub'])
    expect(treffer[0]!.auszuege[0]!.text).toContain('Lissabon')
    expect(store.sucheInChats('der die das', {})).toEqual([])
  })

  it('bleibt im Bereich: im Projekt nur dessen Chats, sonst nur Chats ohne Projekt', () => {
    const projekt = store.createProject({ name: 'Bewerbung' })
    gespraech('Privat', [['user', 'Mein Gehaltswunsch liegt bei 90000']])
    gespraech('Im Projekt', [['user', 'Gehaltswunsch für die Stelle: 85000']], projekt.id)
    expect(store.sucheInChats('Gehaltswunsch', {}).map((t) => t.titel)).toEqual(['Privat'])
    expect(store.sucheInChats('Gehaltswunsch', { projectId: projekt.id }).map((t) => t.titel)).toEqual(['Im Projekt'])
  })

  it('liefert die letzten Chats mit Frage und Antwort und grenzt nach Zeit ein', () => {
    gespraech('Alt', [['user', 'Erste Frage'], ['assistant', 'Erste Antwort']])
    gespraech('Neu', [['user', 'Zweite Frage'], ['assistant', 'Zweite Antwort']])
    const liste = store.letzteChats({})
    expect(liste.map((c) => c.titel)).toEqual(['Neu', 'Alt'])
    expect(liste[0]).toMatchObject({ frage: 'Zweite Frage', antwort: 'Zweite Antwort' })
    expect(store.letzteChats({ bis: 1 })).toEqual([])
  })

  it('bietet die Werkzeuge nur an, wenn die Einstellung an ist', async () => {
    const jetzt = gespraech('Heute', [['user', 'x']])
    gespraech('Urlaub', [['user', 'Lissabon im Mai']])
    const chat = store.getChat(jetzt)!
    expect(mitVerlauf(undefined, { store, chat, settings: { ...DEFAULT_SETTINGS, chatsDurchsuchen: false } })).toBeUndefined()
    const kasten = mitVerlauf(undefined, { store, chat, settings: DEFAULT_SETTINGS })!
    expect(kasten.specs.map((s) => s.name)).toEqual(['chats_durchsuchen', 'letzte_chats'])
    expect((await kasten.execute('1', 'chats_durchsuchen', { anfrage: 'Lissabon' })).output).toContain('Chat „Urlaub“')
  })
})
