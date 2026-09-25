/** Ollama-Provider: native Endpunkte /api/chat, /api/tags (lokal verifiziert). */
import type { ModelInfo } from '@shared/types'
import {
  getJson,
  postJson,
  readLines,
  ProviderError,
  type GenerateHandlers,
  type GenerateRequest,
  type ProviderClient,
  type StopReason
} from './types'

interface TagsResponse {
  models?: {
    name: string
    modified_at?: string
    size?: number
    details?: { parameter_size?: string; context_length?: number; quantization_level?: string }
    capabilities?: string[]
  }[]
}

interface ChatChunk {
  model?: string
  created_at?: string
  message?: {
    role?: string
    content?: string
    thinking?: string
    tool_calls?: { function?: { name?: string; arguments?: Record<string, unknown> } }[]
  }
  done?: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
  error?: string
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

export function createOllamaClient(id: string, baseUrl: string, apiKey?: string): ProviderClient {
  const base = trimSlash(baseUrl)
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {}

  return {
    id,
    kind: 'ollama',
    baseUrl: base,

    async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
      const abort = signal ?? new AbortController().signal
      const data = await getJson<TagsResponse>(`${base}/api/tags`, abort, headers)
      // Reine Einbettungsmodelle (etwa bge-m3) können nicht chatten — sie
      // gehören nicht in die Modellwahl.
      const chatfaehig = (m: NonNullable<TagsResponse['models']>[number]): boolean => {
        const caps = m.capabilities ?? []
        return !(caps.includes('embedding') && !caps.includes('completion'))
      }
      return (data.models ?? []).filter(chatfaehig).map((m) => {
        const caps = m.capabilities ?? []
        return {
          providerId: id,
          id: m.name,
          label: m.name,
          capabilities: {
            tools: caps.includes('tools'),
            thinking: caps.includes('thinking'),
            vision: caps.includes('vision')
          },
          contextLength: m.details?.context_length,
          sizeBytes: m.size
        }
      })
    },

    async generate(req: GenerateRequest, handlers: GenerateHandlers, signal: AbortSignal) {
      const messages = req.messages.map((m) => {
        const out: Record<string, unknown> = { role: m.role, content: m.content }
        if (m.images?.length) out.images = m.images.map((i) => i.dataBase64)
        if (m.toolCalls?.length) {
          out.tool_calls = m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } }))
        }
        if (m.toolResult) {
          out.role = 'tool'
          out.tool_name = m.toolResult.name
          out.content = m.toolResult.ok ? m.toolResult.output : `Fehler: ${m.toolResult.output}`
        }
        return out
      })

      const body: Record<string, unknown> = {
        model: req.model,
        messages,
        stream: true,
        options: {
          ...(req.maxTokens ? { num_predict: req.maxTokens } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {})
        }
      }
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters }
        }))
      }
      /**
       * Denkfeld. Nur bei Modellen, die nachweislich denken: Die Schnittstelle
       * lehnt das Feld bei anderen ab („the model does not support thinking"),
       * statt es zu ignorieren. `false` heißt absagen, eine Stufe heißt
       * „denke in dieser Richtung", und nichts senden heißt automatisch.
       */
      if (req.supportsThinking && req.thinking !== undefined) {
        body.think = req.thinking === 'off' ? false : req.thinking
      }

      /**
       * Sicherungsleiter für Ablehnungen des Denkfelds: erst mit Stufenangabe
       * versuchen, dann nur ja/nein, dann ganz ohne Feld. Lehnt ein Modell die
       * Stufenangabe ab (ältere Fassung, anderes Modell), läuft der Auftrag
       * trotzdem — und nicht mit einer Fehlermeldung, die nichts erklärt.
       */
      const stufen: Array<'stehen' | 'wahr' | 'weg'> =
        typeof body.think === 'string' ? ['stehen', 'wahr', 'weg'] : body.think === false ? ['stehen', 'weg'] : ['stehen']

      let res: Response | undefined
      for (const stufe of stufen) {
        if (stufe === 'wahr') body.think = true
        if (stufe === 'weg') delete body.think
        try {
          res = await postJson(`${base}/api/chat`, body, signal, headers)
          break
        } catch (error) {
          const grund = error instanceof ProviderError ? (error.detail ?? '') : ''
          const grundAmDenkfeld = /think/i.test(grund) && stufe !== 'weg'
          if (!grundAmDenkfeld) throw error
        }
      }
      if (!res) throw new ProviderError('Anbieter lehnte ab', 'Denkfeld wurde in keiner Form angenommen')

      let stopReason: StopReason = 'end'
      let sawToolCall = false
      let textStarted = false
      let thinkingStarted = false
      // Puffer für Tool-Aufrufe, falls Argumente stückchenweise eintreffen.
      const partial = new Map<number, { id: string; name: string; args: string }>()

      for await (const rawLine of readLines(res.body!)) {
        if (signal.aborted) {
          stopReason = 'canceled'
          break
        }
        let chunk: ChatChunk
        try {
          chunk = JSON.parse(rawLine) as ChatChunk
        } catch {
          continue
        }
        if (chunk.error) throw new ProviderError('Modellfehler', chunk.error)

        const content = chunk.message?.content
        if (content) {
          if (!textStarted) textStarted = true
          handlers.onText?.(content)
        }
        const thinking = chunk.message?.thinking
        if (thinking) {
          thinkingStarted = true
          handlers.onThinking?.(thinking)
        }
        const calls = chunk.message?.tool_calls
        if (calls?.length) {
          sawToolCall = true
          for (const call of calls) {
            const fn = call.function
            if (!fn?.name) continue
            // Ollama liefert fertige Argumente; der Vollständigkeitshalber auch Teil-Pfade.
            const args = fn.arguments
            handlers.onToolCall?.({
              id: `call_${Math.random().toString(36).slice(2, 10)}`,
              name: fn.name,
              args: typeof args === 'string' ? safeParse(args) : (args ?? {})
            })
          }
        }
        if (chunk.done) {
          if (chunk.done_reason === 'length') stopReason = 'length'
          handlers.onUsage?.({ input: chunk.prompt_eval_count, output: chunk.eval_count })
          // Das Fertig-Ereignis ist das Ende des Laufs. Auf das Schließen der
          // Verbindung zu warten, würde Läufe aufhängen lassen.
          break
        }
      }
      void textStarted
      void thinkingStarted
      void partial
      return { stopReason: sawToolCall ? 'tool_calls' : stopReason }
    }
  }
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return { _raw: value }
  }
}
