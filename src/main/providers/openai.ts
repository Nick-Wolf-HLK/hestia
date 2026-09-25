/**
 * OpenAI-kompatibler Provider (LM Studio, llama.cpp server, vLLM, Ollama /v1 …).
 * Spricht /chat/completions mit SSE und /models.
 */
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

interface ModelsResponse {
  data?: { id: string }[]
}

interface SseDelta {
  content?: string | null
  reasoning_content?: string | null
  /** Neuere llama.cpp-Fassungen (und vLLM, OpenRouter) nennen das Feld so. */
  reasoning?: string | null
  tool_calls?: {
    index?: number
    id?: string
    function?: { name?: string; arguments?: string }
  }[]
}

interface Chunk {
  choices?: { delta?: SseDelta; finish_reason?: string | null }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}
function withV1(base: string): string {
  return /\/v\d+$/.test(base) ? base : `${base}/v1`
}

/**
 * Was der Rechner für eine Schnittstelle ist: die offene Kompatible oder
 * llama.cpp (meist durch llama-swap verwaltet, das die Modelle bei Bedarf
 * erst lädt). Beide sprechen `/v1/chat/completions`; der Unterschied sitzt bei
 * den Möglichkeiten, die keine Schnittstelle verläßlich ausliest.
 */
export interface KompatibleArt {
  art?: 'openai' | 'llama'
}

/**
 * Ob einem llama.cpp-Modell die Denkstufe angeboten wird.
 *
 * llama.cpp und llama-swap fragen die Fähigkeit nirgends ab; `/props` bleibt
 * vor dem ersten Laden leer. Früher galt: nur wer „think" oder „qwen3" im
 * Namen trägt, denkt — damit fiel etwa Qwen3.8-Flash-Next („flash-next-…“)
 * durch, obwohl es denkt und die Stufe nachweislich befolgt. Jetzt gilt es
 * umgekehrt: angeboten wird, was der Name nicht **ausdrücklich** ausschließt
 * („…-nothink“, „…-instruct“). Das kostet nichts — llama.cpp übergeht die
 * Stufe bei Modellen ohne Denken, und lehnt eine Schnittstelle das Feld ab,
 * wird ohne es wiederholt.
 */
export function denkenErkennen(modellId: string): boolean {
  const wort = modellId.toLowerCase()
  return !/(kein|no|ohne)[-_]?(think|denken)|nothink|instruct\b/.test(wort)
}

/** Gleiche Lesart für den Kontext: „256k“ im Namen ist ein Hinweis, keine Zusage. */
export function kontextAusDemNamen(modellId: string): number | undefined {
  const treffer = /(\d+(?:\.\d+)?)k\b/i.exec(modellId)
  if (!treffer) return undefined
  const wert = Math.round(Number(treffer[1]) * 1024)
  return Number.isFinite(wert) && wert > 0 ? wert : undefined
}

export function createOpenAiClient(id: string, baseUrl: string, apiKey?: string, optionen: KompatibleArt = {}): ProviderClient {
  const art = optionen.art ?? 'openai'
  const root = withV1(trimSlash(baseUrl))
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {}

  return {
    id,
    kind: art,
    baseUrl: root,

    async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
      const abort = signal ?? new AbortController().signal
      const data = await getJson<ModelsResponse>(`${root}/models`, abort, headers)
      return (data.data ?? []).map((m) => ({
        providerId: id,
        id: m.id,
        label: m.id,
        // Ohne zuverläßige Capability-Auskunft: Werkzeuge denkbar. Bei llama.cpp
        // stammt das Denken aus dem Namen (siehe oben), sonst bleibt es unklar.
        capabilities: { tools: true, thinking: art === 'llama' ? denkenErkennen(m.id) : false, vision: false },
        contextLength: kontextAusDemNamen(m.id)
      }))
    },

    async generate(req: GenerateRequest, handlers: GenerateHandlers, signal: AbortSignal) {
      const messages = req.messages.flatMap((m) => {
        if (m.toolResult) {
          return [
            {
              role: 'tool',
              tool_call_id: m.toolResult.callId,
              content: m.toolResult.ok ? m.toolResult.output : `Fehler: ${m.toolResult.output}`
            }
          ]
        }
        const content: unknown[] = []
        if (m.content) content.push({ type: 'text', text: m.content })
        for (const img of m.images ?? []) {
          content.push({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.dataBase64}` } })
        }
        const out: Record<string, unknown> = {
          role: m.role,
          content: content.length === 1 && m.content ? m.content : content
        }
        if (m.toolCalls?.length) {
          out.tool_calls = m.toolCalls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) }
          }))
        }
        return [out]
      })

      const body: Record<string, unknown> = {
        model: req.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {})
      }
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters }
        }))
      }
      /**
       * Die kompatible Schnittstelle kennt nur die Wörter `low`, `medium`, `high`
       * und `none`; ja/nein lehnt sie ab. Gesendet wird nur, wenn wirklich eine
       * Wahl vorliegt — „automatisch" heißt hier, das Feld wegzulassen.
       */
      if (req.thinking !== undefined) {
        body.reasoning_effort = req.thinking === 'off' ? 'none' : req.thinking
      }

      // Nicht jede kompatible Schnittstelle kennt das Denkfeld — und eine, die es
      // nicht kennt, lehnt die ganze Anfrage ab statt es zu übersehen. Also:
      // erst damit, bei einem einschlägigen Grund einmal ohne.
      const anfrage = (mitDenkfeld: boolean) => {
        const packet = { ...body }
        if (!mitDenkfeld) delete packet.reasoning_effort
        return postJson(`${root}/chat/completions`, packet, signal, headers)
      }
      let res: Awaited<ReturnType<typeof postJson>>
      try {
        res = await anfrage(true)
      } catch (fehler) {
        const grund = String(fehler instanceof ProviderError ? fehler.detail ?? '' : fehler)
        if (body.reasoning_effort === undefined || !/reason|think/i.test(grund)) throw fehler
        res = await anfrage(false)
      }

      let stopReason: StopReason = 'end'
      const partial = new Map<number, { id: string; name: string; args: string }>()

      for await (const line of readLines(res.body!)) {
        if (signal.aborted) {
          stopReason = 'canceled'
          break
        }
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') break
        let chunk: Chunk
        try {
          chunk = JSON.parse(payload) as Chunk
        } catch {
          continue
        }
        if (chunk.error?.message) throw new ProviderError('Modellfehler', chunk.error.message)

        const delta = chunk.choices?.[0]?.delta
        if (delta?.content) handlers.onText?.(delta.content)
        // Beide Namen lesen: llama.cpp streamt das Denken inzwischen als
        // `reasoning` — nur `reasoning_content` zu kennen hieß, es zu verschlucken.
        const denken = delta?.reasoning_content ?? delta?.reasoning
        if (denken) handlers.onThinking?.(denken)
        for (const call of delta?.tool_calls ?? []) {
          const index = call.index ?? 0
          const entry = partial.get(index) ?? { id: '', name: '', args: '' }
          if (call.id) entry.id = call.id
          if (call.function?.name) entry.name += call.function.name
          if (call.function?.arguments) entry.args += call.function.arguments
          partial.set(index, entry)
        }
        const finish = chunk.choices?.[0]?.finish_reason
        if (finish === 'tool_calls') stopReason = 'tool_calls'
        if (finish === 'length') stopReason = 'length'
        if (chunk.usage) {
          handlers.onUsage?.({ input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens })
        }
      }

      for (const entry of partial.values()) {
        if (!entry.name) continue
        handlers.onToolCall?.({
          id: entry.id || `call_${Math.random().toString(36).slice(2, 10)}`,
          name: entry.name,
          args: safeParse(entry.args)
        })
      }
      return { stopReason }
    }
  }
}

function safeParse(value: string): unknown {
  if (!value.trim()) return {}
  try {
    return JSON.parse(value)
  } catch {
    return { _raw: value }
  }
}
