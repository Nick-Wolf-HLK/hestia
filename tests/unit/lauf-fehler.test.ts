/**
 * Ein gescheiterter Lauf darf die Oberfläche nicht im Zustand „läuft“ lassen.
 * So geschehen: „Anbieter lehnte ab“, darunter weiter „Denkt nach …“ und ein
 * Stop-Knopf — ein Lauf, der scheitert, meldet kein „fertig“.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('window', { desk: { chats: { list: async () => [] } } })

import { appStore } from '../../src/renderer/src/lib/store'

beforeEach(() => {
  appStore.beginStream('s1', 'c1')
})

describe('ein gescheiterter Lauf', () => {
  it('gibt den Zustand „läuft“ frei und zeigt die Ursache an der Antwort', () => {
    appStore.applyStreamEvent({ streamId: 's1', type: 'start', chatId: 'c1', messageId: 'a1' })
    appStore.applyStreamEvent({ streamId: 's1', type: 'error', chatId: 'c1', messageId: 'a1', message: 'Das Modell „gemma3:4b“ ist beim Anbieter nicht installiert.' })
    const zustand = appStore.get()
    expect(zustand.streamingByChat['c1']).toBeUndefined()
    expect(zustand.streaming).toBeUndefined()
    expect(zustand.messages['c1']!.at(-1)!.error).toContain('nicht installiert')
  })

  it('auch wenn er scheitert, bevor es eine Antwort gab', () => {
    appStore.applyStreamEvent({ streamId: 's1', type: 'error', chatId: 'c1', messageId: '', message: 'Kein Anbieter eingerichtet.' })
    const zustand = appStore.get()
    expect(zustand.streamingByChat['c1']).toBeUndefined()
    expect(zustand.error).toBe('Kein Anbieter eingerichtet.')
  })
})
