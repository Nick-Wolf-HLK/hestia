/**
 * Das Denkbudget im ganzen Lauf: ein vorgetäuschtes Modell denkt ohne Ende.
 * Bei „Niedrig“ muss die App kappen, ohne Denken nachfragen und die Antwort
 * sauber zusammensetzen; bei „Hoch“ darf sie nicht eingreifen.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {
    static isSupported(): boolean {
      return false
    }
  },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  powerSaveBlocker: { start: () => 1, stop: () => undefined, isStarted: () => false }
}))

import { ChatRunner } from '../../src/main/chat'
import { denkBudget } from '../../src/shared/reasoning'
import type { Chat, Message, ReasoningChoice, StreamEvent } from '../../src/shared/types'
import type { GenerateHandlers, GenerateRequest } from '../../src/main/providers/types'

function aufbau(stufe: ReasoningChoice) {
  const chat: Chat = { id: 'c1', title: 'Neuer Chat', mode: 'chat', pinned: false, createdAt: 0, updatedAt: 0, model: 'p|m' }
  const nachrichten = new Map<string, Message>()
  const store = {
    isClosed: false,
    getChat: () => chat,
    insertMessage: (m: Message) => (nachrichten.set(m.id, m), m),
    updateMessage: (id: string, patch: Partial<Message>) => nachrichten.set(id, { ...nachrichten.get(id)!, ...patch }),
    listMessages: () => [...nachrichten.values()],
    renameChat: () => undefined,
    touchChat: () => undefined,
    listProjects: () => [],
    // Gedächtnis und Dokumente: in diesem Lauf leer.
    listErinnerungen: () => [],
    dokumenteFuer: () => [],
    // Gesprächsbaum: hier eine gerade Linie ohne weitere Fassungen.
    schwestern: (id: string) => [nachrichten.get(id)].filter(Boolean),
    getMessage: (id: string) => nachrichten.get(id),
    pfadBis: () => [...nachrichten.values()],
    setzeBlatt: () => undefined
  }
  const anfragen: GenerateRequest[] = []
  const client = {
    id: 'p',
    kind: 'ollama' as const,
    baseUrl: '',
    listModels: async () => [],
    async generate(req: GenerateRequest, handlers: GenerateHandlers, signal: AbortSignal) {
      anfragen.push(req)
      if (req.thinking !== 'off') {
        // Denkt, bis jemand abbricht — höchstens 20 000 Zeichen.
        for (let i = 0; i < 100; i++) {
          if (signal.aborted) throw Object.assign(new Error('abgebrochen'), { name: 'AbortError' })
          handlers.onThinking?.('x'.repeat(200))
          await new Promise((r) => setTimeout(r, 0))
        }
      }
      handlers.onText?.('35')
      handlers.onUsage?.({ input: 10, output: 2 })
      return { stopReason: 'end' as const }
    }
  }
  const registry = {
    resolve: () => ({ client, model: 'm', providerId: 'p' }),
    models: async () => [{ providerId: 'p', id: 'm', label: 'm', capabilities: { tools: false, thinking: true, vision: false } }]
  }
  const settings = { get: () => ({ reasoning: { 'p|m': stufe }, effort: 'auto', defaultModelChat: 'p|m' }) }
  const runner = new ChatRunner(store as never, registry as never, settings as never)
  return { runner, anfragen, nachrichten }
}

async function lauf(stufe: ReasoningChoice) {
  const teile = aufbau(stufe)
  const ereignisse: StreamEvent[] = []
  await teile.runner.send({ chatId: 'c1', text: 'Frage', model: 'p|m' }, (e) => ereignisse.push(e))
  const antwort = [...teile.nachrichten.values()].find((m) => m.role === 'assistant')!
  const text = antwort.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('')
  const denken = antwort.parts.filter((p) => p.type === 'thinking').map((p) => (p as { text: string }).text).join('')
  const kennzahl = antwort.parts.find((p) => p.type === 'metrics') as { outputTokens: number } | undefined
  return { ...teile, text, denken, kennzahl, ereignisse }
}

describe('Denkbudget', () => {
  it('kappt bei „Niedrig“, fragt ohne Denken nach und gibt die Überlegungen mit', async () => {
    const { anfragen, text, denken, kennzahl } = await lauf('low')
    expect(anfragen).toHaveLength(2)
    expect(anfragen[0]!.thinking).toBe('low')
    expect(anfragen[1]!.thinking).toBe('off')
    expect(anfragen[1]!.messages.at(-1)!.content).toContain('Überlegungen')
    expect(text).toBe('35')
    // Das Denken endet knapp über dem Budget, mit sichtbarem Hinweis.
    const budget = denkBudget('low')!
    expect(denken.length).toBeGreaterThan(budget)
    expect(denken.length).toBeLessThan(budget + 400)
    expect(denken).toContain('Denkbudget')
    // Die gedachten Token zählen mit, nicht nur die der Nachfrage.
    expect(kennzahl!.outputTokens).toBeGreaterThan(100)
  })

  it('lässt „Hoch“ unbegrenzt denken', async () => {
    const { anfragen, text, denken } = await lauf('high')
    expect(anfragen).toHaveLength(1)
    expect(anfragen[0]!.maxTokens).toBeGreaterThan(8192)
    expect(denken.length).toBe(20_000)
    expect(text).toBe('35')
  })

  it('schickt bei „Aus“ kein Denken und kappt nichts', async () => {
    const { anfragen, denken, text } = await lauf('off')
    expect(anfragen).toHaveLength(1)
    expect(anfragen[0]!.thinking).toBe('off')
    expect(denken).toBe('')
    expect(text).toBe('35')
  })

  it('Mittel liegt zwischen Niedrig und Hoch', () => {
    expect(denkBudget('low')!).toBeLessThan(denkBudget('medium')!)
    expect(denkBudget('high')).toBeUndefined()
    expect(denkBudget('off')).toBeUndefined()
  })

  it('nimmt keinen zweiten Lauf im selben Chat an, solange der erste läuft — nach dem Stopp schon', async () => {
    const { runner } = aufbau('high')
    const ereignisse: StreamEvent[] = []
    const erster = runner.send({ chatId: 'c1', text: 'Frage', model: 'p|m', streamId: 's1' }, (e) => ereignisse.push(e))
    await new Promise((r) => setTimeout(r, 0))
    await expect(runner.send({ chatId: 'c1', text: 'Noch eine', model: 'p|m' }, () => undefined)).rejects.toThrow(/gerade noch eine Antwort/)
    runner.stop('s1')
    await expect(runner.send({ chatId: 'c1', text: 'Nach dem Stopp', model: 'p|m' }, () => undefined)).resolves.toBeTruthy()
    await erster
  })
})
