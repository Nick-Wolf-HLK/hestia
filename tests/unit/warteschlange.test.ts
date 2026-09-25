/**
 * Nachrichten, die während einer Antwort geschrieben werden, warten und gehen
 * danach von allein raus — der Reihe nach, eine pro Antwort.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gesendet: Array<{ chatId: string; text: string; recherche?: boolean }> = []
let laufNummer = 0

vi.stubGlobal('window', {
  desk: {
    chats: { list: async () => [], get: async () => ({ messages: [] }) },
    messages: {
      send: async (payload: { chatId: string; text: string; recherche?: boolean }) => {
        gesendet.push(payload)
        return { streamId: `lauf-${++laufNummer}` }
      }
    },
    settings: { set: async (patch: unknown) => patch }
  }
})

import { appStore } from '../../src/renderer/src/lib/store'

const warte = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

beforeEach(() => {
  gesendet.length = 0
})

describe('Warteschlange', () => {
  it('hält Nachrichten zurück, solange eine Antwort läuft, und sendet sie danach nacheinander', async () => {
    appStore.beginStream('s0', 'c1')
    appStore.einreihen('c1', { text: 'Noch etwas' })
    appStore.einreihen('c1', { text: 'Und noch etwas', recherche: true })
    await warte()
    expect(gesendet).toHaveLength(0)
    expect(appStore.get().warteschlange['c1']!.map((e) => e.text)).toEqual(['Noch etwas', 'Und noch etwas'])

    // Erste Antwort fertig → die erste wartende geht raus, die zweite wartet weiter.
    appStore.applyStreamEvent({ streamId: 's0', type: 'done', chatId: 'c1', messageId: '' })
    await warte()
    expect(gesendet.map((g) => g.text)).toEqual(['Noch etwas'])
    expect(appStore.get().warteschlange['c1']!.map((e) => e.text)).toEqual(['Und noch etwas'])

    // Deren Antwort fertig → die nächste, mit eingeschalteter Recherche.
    appStore.applyStreamEvent({ streamId: 'lauf-1', type: 'done', chatId: 'c1', messageId: '' })
    await warte()
    expect(gesendet.map((g) => g.text)).toEqual(['Noch etwas', 'Und noch etwas'])
    expect(gesendet[1]!.recherche).toBe(true)
    expect(appStore.get().warteschlange['c1']).toEqual([])
  })

  it('lässt eine entfernte Nachricht aus', async () => {
    appStore.beginStream('s9', 'c2')
    appStore.einreihen('c2', { text: 'Doch nicht' })
    const [eintrag] = appStore.get().warteschlange['c2']!
    appStore.ausReihe('c2', eintrag!.id)
    appStore.applyStreamEvent({ streamId: 's9', type: 'done', chatId: 'c2', messageId: '' })
    await warte()
    expect(gesendet).toHaveLength(0)
  })

  it('sendet sofort, wenn die Antwort beim Einreihen schon fertig war', async () => {
    appStore.einreihen('c3', { text: 'Gleich raus' })
    await warte()
    expect(gesendet.map((g) => g.text)).toEqual(['Gleich raus'])
  })
})
