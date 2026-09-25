/**
 * llama.cpp (und llama-swap davor) durch denselbe offene Schnittstelle.
 *
 * Nichts hier startet ein Modell: geprüft werden die Liste und die gesendeten
 * Felder gegen einen eigenen Stand. Das ist das eigentliche Versprechen —
 * welches Feld wann wegbleibt, entscheidet sich vor dem ersten Token.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createOpenAiClient, denkenErkennen, kontextAusDemNamen } from '../../src/main/providers/openai'
import { ProviderError } from '../../src/main/providers/types'

const protokolle: Array<Record<string, unknown>> = []
let stand: Server
let anschluss = ''
/** Was die nächste Chat-Anfrage antwortet: erst ablehnend, dann wohlgesonnen. */
let antwortfolgemitglied: Array<{ status: number; grund?: string }> = []
let zähler = 0

function sende(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(typeof body === 'string' ? body : JSON.stringify(body))
}

beforeAll(async () => {
  stand = createServer((request, response) => {
    const pfad = new URL(request.url ?? '/', 'http://localhost').pathname
    if (pfad === '/v1/models') {
      sende(response, 200, {
        data: [
          { id: 'flash-next-256k', object: 'model' },
          { id: 'klein-unbegrenzt-denken', object: 'model' },
          { id: 'alt-nothink', object: 'model' },
          { id: 'qwen3-32b', object: 'model' }
        ]
      })
      return
    }
    if (pfad === '/v1/chat/completions') {
      let leib = ''
      request.on('data', (brocken) => (leib += brocken))
      request.on('end', () => {
        protokolle.push(JSON.parse(leib || '{}') as Record<string, unknown>)
        const vorgabe = antwortfolgemitglied[Math.min(zähler, antwortfolgemitglied.length - 1)] ?? { status: 200 }
        zähler += 1
        if (vorgabe.status !== 200) {
          sende(response, vorgabe.status, JSON.stringify({ error: { message: vorgabe.grund ?? 'abgelehnt' } }))
          return
        }
        // Die Schnittstelle wird als Strom angesprochen, also antwortet der Stand
        // ebenfalls als Strom — sonst mißt die Prüfung etwas anderes als gemeint.
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(`data: {"choices":[{"index":0,"delta":{"content":"Fertig."}}]}\n\n`)
        response.write(`data: {"choices":[{"index":0,"finish_reason":"stop","delta":{}}]}\n\n`)
        response.end('data: [DONE]\n\n')
      })
      return
    }
    sende(response, 404, { error: { message: 'unbekannt' } })
  })
  await new Promise<void>((resolve) => stand.listen(0, '127.0.0.1', resolve))
  anschluss = `http://127.0.0.1:${(stand.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => stand.close(() => resolve()))
})

function zurücksetzen() {
  protokolle.length = 0
  antwortfolgemitglied = [{ status: 200 }]
  zähler = 0
}

describe('llama.cpp-Anbieter', () => {
  it('erkennt das Denken am Namen — und zwar beides', () => {
    // Ohne ausdrücklichen Ausschluss wird angeboten — Flash-Next denkt.
    expect(denkenErkennen('flash-next-256k')).toBe(true)
    expect(denkenErkennen('klein-unbegrenzt-denken')).toBe(true)
    expect(denkenErkennen('qwen3-32b')).toBe(true)
    expect(denkenErkennen('alt-nothink')).toBe(false)
  })

  it('liest den Kontext aus dem Namen, ohne ihn zu erfinden', () => {
    expect(kontextAusDemNamen('flash-next-256k')).toBe(262144)
    expect(kontextAusDemNamen('flash-next')).toBeUndefined()
  })

  it('merkt die Modelle mit Fähigkeiten und Kontext', async () => {
    zurücksetzen()
    const client = createOpenAiClient('llama', anschluss, undefined, { art: 'llama' })
    const modelle = await client.listModels()
    expect(client.kind).toBe('llama')
    expect(modelle.find((m) => m.id === 'flash-next-256k')?.contextLength).toBe(262144)
    expect(modelle.find((m) => m.id === 'klein-unbegrenzt-denken')?.capabilities.thinking).toBe(true)
    expect(modelle.find((m) => m.id === 'alt-nothink')?.capabilities.thinking).toBe(false)
  })

  it('sendet reasoning_effort, wenn eine Denkstufe gewählt ist', async () => {
    zurücksetzen()
    const client = createOpenAiClient('llama', anschluss, undefined, { art: 'llama' })
    await client.generate({ model: 'x', messages: [{ role: 'user', content: 'Hallo' }], thinking: 'off' }, {}, new AbortController().signal)
    expect(protokolle[0]?.reasoning_effort).toBe('none')
  })

  it('lässt das Feld weg, wenn nichts gewählt ist — und versucht nicht doppelt', async () => {
    zurücksetzen()
    const client = createOpenAiClient('llama', anschluss, undefined, { art: 'llama' })
    await client.generate({ model: 'x', messages: [{ role: 'user', content: 'Hallo' }] }, {}, new AbortController().signal)
    expect(protokolle.length).toBe(1)
    expect(protokolle[0]?.reasoning_effort).toBeUndefined()
  })

  it('versucht es ohne das Denkfeld, wenn die Schnittstelle es ablehnt', async () => {
    zurücksetzen()
    antwortfolgemitglied = [{ status: 400, grund: "unknown parameter 'reasoning_effort'" }, { status: 200 }]
    const client = createOpenAiClient('llama', anschluss, undefined, { art: 'llama' })
    let tekst = ''
    const lauf = await client.generate(
      { model: 'x', messages: [{ role: 'user', content: 'Hallo' }], thinking: 'medium' },
      { onText: (wort) => (tekst += wort) },
      new AbortController().signal
    )
    expect(protokolle.length).toBe(2)
    expect(protokolle[0]?.reasoning_effort).toBe('medium')
    expect(protokolle[1]?.reasoning_effort).toBeUndefined()
    expect(tekst).toBe('Fertig.')
    expect(lauf).toBeTruthy()
  })

  it('wirft sofort, wenn die Absage nichts mit dem Denkfeld zu tun hat', async () => {
    zurücksetzen()
    antwortfolgemitglied = [{ status: 400, grund: 'Kontext zu lang' }]
    const client = createOpenAiClient('llama', anschluss, undefined, { art: 'llama' })
    await expect(
      client.generate({ model: 'x', messages: [{ role: 'user', content: 'Hallo' }], thinking: 'high' }, {}, new AbortController().signal)
    ).rejects.toBeInstanceOf(ProviderError)
    expect(protokolle.length).toBe(1)
  })
})
