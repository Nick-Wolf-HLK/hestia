import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createOllamaClient } from '../../src/main/providers/ollama'
import { createOpenAiClient } from '../../src/main/providers/openai'
import type { GenerateHandlers } from '../../src/main/providers/types'

interface Capture extends GenerateHandlers {
  text: string
  thinking: string
  calls: { name: string; args: unknown }[]
  usage?: { input?: number; output?: number }
}

function capture(): Capture {
  return {
    text: '',
    thinking: '',
    calls: [],
    onText(t) {
      this.text += t
    },
    onThinking(t) {
      this.thinking += t
    },
    onToolCall(call) {
      this.calls.push({ name: call.name, args: call.args })
    },
    onUsage(u) {
      this.usage = u
    }
  }
}

/** Die Argumente eines Werkzeugs kommen absichtlich in zwei Hälften an. */
const ARGS_FIRST = '{"pa'
const ARGS_SECOND = 'th": "src"}'

let server: Server | undefined

/** Lokaler Anbieter-Ring: NDJSON für Ollama, SSE für OpenAI-kompatibel. */
async function start(kind: 'ollama' | 'openai'): Promise<string> {
  server = createServer((req, res) => {
    if (req.url?.endsWith('/api/tags')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          models: [
            {
              name: 'test-modell:latest',
              size: 1000,
              details: { context_length: 32768 },
              capabilities: ['completion', 'tools', 'thinking']
            }
          ]
        })
      )
      return
    }
    if (req.url?.endsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'test-modell' }] }))
      return
    }

    if (kind === 'ollama') {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      // Ollama sendet eine JSON-Zeile pro Ereignis — das Zeilenende ist Pflicht.
      const write = (payload: unknown): void => {
        res.write(`${JSON.stringify(payload)}\n`)
      }
      write({ message: { role: 'assistant', thinking: 'Ich überlege. ' } })
      write({ message: { role: 'assistant', content: 'Hallo ' } })
      write({ message: { role: 'assistant', content: 'Welt' } })
      write({ message: { role: 'assistant' }, done: true, prompt_eval_count: 11, eval_count: 5 })
      res.end()
      return
    }

    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const send = (payload: unknown): void => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }
    send({ choices: [{ delta: { reasoning_content: 'Denke. ' } }] })
    // Neuere llama.cpp-Fassungen: dasselbe unter `reasoning`.
    send({ choices: [{ delta: { content: '', reasoning: 'Weiter. ' } }] })
    send({ choices: [{ delta: { content: 'Hallo ' } }] })
    send({
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'list_dir', arguments: ARGS_FIRST } }] } }]
    })
    send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ARGS_SECOND } }] } }] })
    send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
    send({ usage: { prompt_tokens: 7, completion_tokens: 3 } })
    res.end('data: [DONE]\n\n')
  })

  await new Promise<void>((resolvePromise) => server?.listen(0, '127.0.0.1', resolvePromise))
  const address = server?.address()
  return typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
}

afterEach(async () => {
  await new Promise<void>((resolvePromise) => (server ? server.close(() => resolvePromise()) : resolvePromise()))
  server = undefined
})

describe('Ollama-Provider', () => {
  it('liest die Modelliste inklusive Fähigkeiten', async () => {
    const url = await start('ollama')
    const models = await createOllamaClient('test', url).listModels()
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      id: 'test-modell:latest',
      capabilities: { tools: true, thinking: true, vision: false },
      contextLength: 32768
    })
  })

  it('trennt Denktext von Antwort und meldet Zähler', async () => {
    const url = await start('ollama')
    const sink = capture()
    const result = await createOllamaClient('test', url).generate(
      { model: 'test-modell:latest', messages: [{ role: 'user', content: 'hi' }] },
      sink,
      new AbortController().signal
    )
    expect(sink.text).toBe('Hallo Welt')
    expect(sink.thinking).toBe('Ich überlege. ')
    expect(sink.usage).toMatchObject({ input: 11, output: 5 })
    expect(result.stopReason).toBe('end')
  })
})

describe('Stream-Ende', () => {
  it('endet, obwohl der Server die Verbindung offen hält', async () => {
    // Realitätsnah: Ollama schickt das fertig-Stück und lässt die Leitung stehen.
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write(`${JSON.stringify({ message: { role: 'assistant', content: 'Fertig.' } })}\n`)
      res.write(`${JSON.stringify({ message: { role: 'assistant' }, done: true, eval_count: 2 })}\n`)
      // bewusst kein res.end()
    })
    await new Promise<void>((resolvePromise) => server?.listen(0, '127.0.0.1', resolvePromise))
    const address = server?.address()
    const url = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''

    const sink = capture()
    const started = Date.now()
    const result = await createOllamaClient('test', url).generate(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      sink,
      new AbortController().signal
    )
    expect(sink.text).toBe('Fertig.')
    expect(result.stopReason).toBe('end')
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

describe('OpenAI-kompatibler Provider', () => {
  it('setzt fragmentierte Werkzeugargumente zusammen', async () => {
    const url = await start('openai')
    const sink = capture()
    const result = await createOpenAiClient('test', url).generate(
      { model: 'test-modell', messages: [{ role: 'user', content: 'hi' }] },
      sink,
      new AbortController().signal
    )
    expect(sink.text).toBe('Hallo ')
    expect(sink.thinking).toBe('Denke. Weiter. ')
    expect(sink.calls).toHaveLength(1)
    expect(sink.calls[0]?.name).toBe('list_dir')
    expect(sink.calls[0]?.args).toEqual({ path: 'src' })
    expect(result.stopReason).toBe('tool_calls')
    expect(sink.usage).toMatchObject({ input: 7, output: 3 })
  })
})

describe('Ablehnungen verständlich', () => {
  it('sagt, was der Anbieter wirklich meldete', async () => {
    const { ablehnungsText } = await import('../../src/main/providers/types')
    // llama-swap / OpenAI-kompatibel
    expect(ablehnungsText(404, '{"error":{"message":"model \'gemma3:4b\' not found","type":"not_found_error"}}')).toBe(
      'Das Modell „gemma3:4b“ ist beim Anbieter nicht installiert.'
    )
    // Ollama
    expect(ablehnungsText(404, '{"error":"model \\"llama9\\" not found, try pulling it first"}')).toBe('Das Modell „llama9“ ist beim Anbieter nicht installiert.')
    expect(ablehnungsText(400, '{"error":"registry.ollama.ai/library/x does not support tools"}')).toBe('Dieses Modell kann keine Werkzeuge benutzen.')
    expect(ablehnungsText(401, 'unauthorized')).toMatch(/API-Schlüssel/)
    expect(ablehnungsText(500, '{"error":"etwas anderes"}')).toBe('Anbieter lehnte ab: etwas anderes')
    expect(ablehnungsText(502, '')).toBe('Anbieter lehnte ab (502)')
  })
})
