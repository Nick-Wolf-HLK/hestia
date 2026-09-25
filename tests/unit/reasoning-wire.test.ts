/**
 * Beweis auf der Leitungsseite: Was liegt tatsächlich im Anfragekörper, wenn
 * jemand eine Denkstufe einstellt?
 *
 * Absichtlich **kein** Modelllauf. Ein Standpunkt-Server zeichnet die Körper auf
 * und antwortet vorgetäuscht. So ist die Frage „greift das wirklich?" von der
 * beantwortet, die man sonst nur durch Ausprobieren an einem echten Modell
 * klären könnte — und das Ergebnis hängt nicht davon ab, wie Laune oder
 * Fähigkeiten eines gerade laufenden Modells sind.
 */
import http from 'node:http'
import net from 'node:net'
import { describe, expect, it } from 'vitest'
import { createOllamaClient } from '../../src/main/providers/ollama'
import { createOpenAiClient } from '../../src/main/providers/openai'
import { denkRegel } from '../../src/shared/reasoning'
import type { GenerateRequest } from '../../src/main/providers/types'

const ollamaAntwort = '{"model":"m","message":{"role":"assistant","content":"fertig"},"done":true}\n'
const offenAntwort =
  'data: {"choices":[{"delta":{"content":"fertig"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'

/** Ein Standpunkt, der jede empfangene Anfrage aufschreibt. */
async function standpunkt(antworten: Array<{ status?: number; grund?: string; inhalt?: string }> = []) {
  const empfangen: Array<Record<string, unknown>> = []
  let versuch = 0
  const server = http.createServer((req, res) => {
    let daten = ''
    req.on('data', (brocken) => (daten += brocken))
    req.on('end', () => {
      empfangen.push(JSON.parse(daten || '{}') as Record<string, unknown>)
      const vorlage = antworten[Math.min(versuch, antworten.length - 1)] ?? {}
      versuch += 1
      if (vorlage.status && vorlage.status !== 200) {
        res.writeHead(vorlage.status, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: vorlage.grund ?? 'abgelehnt' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.end(vorlage.inhalt ?? ollamaAntwort)
    })
  })
  await new Promise<void>(((fertig) => server.listen(0, '127.0.0.1', fertig)))
  const port = (server.address() as net.AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    empfangen,
    letzter: () => empfangen[empfangen.length - 1],
    zu: () => new Promise<void>((fertig) => server.close(() => fertig()))
  }
}

async function sende(client: ReturnType<typeof createOllamaClient>, anfrage: GenerateRequest): Promise<void> {
  await client.generate(anfrage, {}, new AbortController().signal)
}

describe('Denkfeld auf der Leitung (Ollama)', () => {
  it('sendet nichts, wenn die Stufe auf Automatik steht', async () => {
    const stand = await standpunkt()
    try {
      await sende(createOllamaClient('test', stand.url), { model: 'm', messages: [{ role: 'user', content: 'hallo' }] })
      expect(stand.letzter()).not.toHaveProperty('think')
    } finally {
      await stand.zu()
    }
  })

  it('sagt dem Modell ausdrücklich ab, wenn aus gewählt ist', async () => {
    const stand = await standpunkt()
    try {
      await sende(createOllamaClient('test', stand.url), {
        model: 'm',
        messages: [{ role: 'user', content: 'hallo' }],
        thinking: 'off',
        supportsThinking: true
      })
      expect(stand.letzter()?.think).toBe(false)
    } finally {
      await stand.zu()
    }
  })

  it('schickt die Stufenangabe, die die Schnittstelle kennt', async () => {
    for (const stufe of ['low', 'medium', 'high'] as const) {
      const stand = await standpunkt()
      try {
        await sende(createOllamaClient('test', stand.url), {
          model: 'm',
          messages: [{ role: 'user', content: 'hallo' }],
          thinking: stufe,
          supportsThinking: true
        })
        expect(stand.letzter()?.think).toBe(stufe)
      } finally {
        await stand.zu()
      }
    }
  })

  it('lässt das Feld weg, obwohl eine Stufe gewählt ist — das Modell kann nicht denken', async () => {
    // Das war der Schaden: Die Stufe wurde blind gesendet, und Modelle ohne
    // Denken antworteten mit einer Fehlermeldung statt mit einer Antwort.
    const stand = await standpunkt()
    try {
      await sende(createOllamaClient('test', stand.url), {
        model: 'm',
        messages: [{ role: 'user', content: 'hallo' }],
        thinking: 'high',
        supportsThinking: false
      })
      expect(stand.letzter()).not.toHaveProperty('think')
    } finally {
      await stand.zu()
    }
  })

  it('geht eine Stufe zurück, wenn die Stufenangabe abgelehnt wird', async () => {
    const stand = await standpunkt([
      { status: 400, grund: 'this model does not support thinking effort levels' },
      { inhalt: ollamaAntwort }
    ])
    try {
      await sende(createOllamaClient('test', stand.url), {
        model: 'm',
        messages: [{ role: 'user', content: 'hallo' }],
        thinking: 'medium',
        supportsThinking: true
      })
      expect(stand.empfangen[0]?.think).toBe('medium')
      expect(stand.empfangen[1]?.think).toBe(true)
    } finally {
      await stand.zu()
    }
  })

  it('lässt das Feld ganz, wenn auch ja/nein abgelehnt wird', async () => {
    const stand = await standpunkt([
      { status: 400, grund: 'this model does not support thinking' },
      { status: 400, grund: 'this model does not support thinking' },
      { inhalt: ollamaAntwort }
    ])
    try {
      await sende(createOllamaClient('test', stand.url), {
        model: 'm',
        messages: [{ role: 'user', content: 'hallo' }],
        thinking: 'low',
        supportsThinking: true
      })
      expect(stand.empfangen).toHaveLength(3)
      expect(stand.empfangen[2]).not.toHaveProperty('think')
    } finally {
      await stand.zu()
    }
  })

  it('wirft unverändert, wenn der Fehler nichts mit dem Denkfeld zu tun hat', async () => {
    const stand = await standpunkt([{ status: 500, grund: 'interner Fehler' }])
    try {
      await expect(
        sende(createOllamaClient('test', stand.url), {
          model: 'm',
          messages: [{ role: 'user', content: 'hallo' }],
          thinking: 'low',
          supportsThinking: true
        })
      ).rejects.toThrow()
      expect(stand.empfangen).toHaveLength(1)
    } finally {
      await stand.zu()
    }
  })
})

describe('Denkfeld auf der Leitung (kompatible Schnittstelle)', () => {
  it('kennt nur die eigenen Wörter: none statt false', async () => {
    const stand = await standpunkt([{ inhalt: offenAntwort }])
    try {
      await sende(createOpenAiClient('test', stand.url), {
        model: 'm',
        messages: [{ role: 'user', content: 'hallo' }],
        thinking: 'off'
      })
      expect(stand.letzter()?.reasoning_effort).toBe('none')
      expect(stand.letzter()).not.toHaveProperty('think')
    } finally {
      await stand.zu()
    }
  })

  it('lässt das Feld bei Automatik weg', async () => {
    const stand = await standpunkt([{ inhalt: offenAntwort }])
    try {
      await sende(createOpenAiClient('test', stand.url), {
        model: 'm',
        messages: [{ role: 'user', content: 'hallo' }]
      })
      expect(stand.letzter()).not.toHaveProperty('reasoning_effort')
    } finally {
      await stand.zu()
    }
  })

  it('reicht eine Stufe unverändert weiter', async () => {
    const stand = await standpunkt([{ inhalt: offenAntwort }])
    try {
      await sende(createOpenAiClient('test', stand.url), {
        model: 'm',
        messages: [{ role: 'user', content: 'hallo' }],
        thinking: 'high'
      })
      expect(stand.letzter()?.reasoning_effort).toBe('high')
    } finally {
      await stand.zu()
    }
  })
})

describe('Regel für die Denkstufe', () => {
  const basis = { reasoning: {}, vorgabe: 'auto' as const }

  it('Automatik sendet nichts, Aus sagt ab', () => {
    expect(denkRegel({ ...basis, faehigkeit: true }).thinking).toBeUndefined()
    expect(denkRegel({ ...basis, vorgabe: 'off', faehigkeit: true })).toEqual({
      thinking: 'off',
      supportsThinking: true
    })
  })

  it('die Vorgabe für ein Modell gewinnt gegen die allgemeine', () => {
    const regel = denkRegel({
      bezug: 'ollama-local|gemma4:26b',
      reasoning: { 'ollama-local|gemma4:26b': 'off', 'ollama-local|deepseek:cloud': 'high' },
      vorgabe: 'low',
      faehigkeit: true
    })
    expect(regel.thinking).toBe('off')
  })

  it('ohne nachweisliche Fähigkeit wird nie ein Denkfeld gesendet', () => {
    const regel = denkRegel({ bezug: 'a|m', reasoning: { 'a|m': 'high' }, vorgabe: 'auto', faehigkeit: false })
    expect(regel.supportsThinking).toBe(false)
  })

  it('unbekannte Fähigkeit gilt nicht als Fähigkeit', () => {
    expect(denkRegel({ ...basis, faehigkeit: undefined }).supportsThinking).toBe(false)
  })
})
