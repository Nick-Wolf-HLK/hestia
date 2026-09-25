/** Abstraktion über lokale Modell-Anbieter: ein Format für alles. */
import type { ModelInfo } from '@shared/types'

export interface ImageAttachment {
  mediaType: string
  dataBase64: string
}

export interface ToolCall {
  id: string
  name: string
  args: unknown
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: ImageAttachment[]
  /** Vom Assistenten angeforderte Werkzeuge (für die Fortsetzung nötig). */
  toolCalls?: ToolCall[]
  /** Ergebnis eines Werkzeugs, gesendet als eigene Rolle. */
  toolResult?: { callId: string; name: string; ok: boolean; output: string }
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface GenerateRequest {
  model: string
  messages: LlmMessage[]
  tools?: ToolSpec[]
  /**
   * Denkstufe. Nicht senden heißt: das Modell entscheidet selbst. `off` heißt:
   * ihm ausdrücklich absagen.
   */
  thinking?: 'off' | 'low' | 'medium' | 'high'
  /**
   * Ob das Modell überhaupt denken kann. Ohne diese Angabe läuft man bei
   * Modellen ohne Denken auf eine Fehlermeldung, sobald `think` mitgeschickt
   * wird — die Schnittstelle lehnt das Feld dort ab statt es zu ignorieren.
   */
  supportsThinking?: boolean
  maxTokens?: number
  temperature?: number
}

export interface GenerateHandlers {
  onText?: (text: string) => void
  onThinking?: (text: string) => void
  onToolCall?: (call: ToolCall) => void
  onUsage?: (usage: { input?: number; output?: number }) => void
}

export type StopReason = 'end' | 'tool_calls' | 'length' | 'canceled' | 'error'

export interface ProviderClient {
  id: string
  kind: 'ollama' | 'openai' | 'llama'
  baseUrl: string
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>
  generate(
    req: GenerateRequest,
    handlers: GenerateHandlers,
    signal: AbortSignal
  ): Promise<{ stopReason: StopReason; raw?: unknown }>
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/** Liest einen Fetch-Body zeilenweise (NDJSON oder SSE). */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) {
        finished = true
        break
      }
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '')
        buffer = buffer.slice(idx + 1)
        if (line.length > 0) yield line
      }
    }
    if (buffer.length > 0) yield buffer
  } finally {
    // Wer vorzeitig aussteigt (Antwort fertig, Verbindung noch offen), muss die
    // Verbindung schließen — sonst hängt der Aufruf bis zum Timeout.
    if (!finished) {
      await reader.cancel().catch(() => undefined)
    }
    reader.releaseLock()
  }
}

/** HTTP-POST mit JSON-Body, Fehler in ProviderError überführt. */
export async function postJson(
  url: string,
  payload: unknown,
  signal: AbortSignal,
  headers: Record<string, string> = {}
): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal
    })
  } catch (e) {
    const err = e as Error
    if (err.name === 'AbortError') throw err
    throw new ProviderError('Anbieter nicht erreichbar', `${url}: ${err.message}`)
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new ProviderError(ablehnungsText(res.status, text), `${res.status} ${res.statusText} ${text.slice(0, 400)}`, res.status)
  }
  return res
}

/**
 * Was der Anbieter wirklich gesagt hat — statt nur „lehnte ab“. Die
 * Schnittstellen schicken den Grund als JSON (`{"error": …}` bei Ollama,
 * `{"error": {"message": …}}` bei OpenAI-kompatiblen). Häufige Fälle werden
 * übersetzt; alles andere steht im Wortlaut dahinter.
 */
export function ablehnungsText(status: number, text: string): string {
  let grund: string
  try {
    const daten = JSON.parse(text) as { error?: string | { message?: string }; message?: string }
    grund = typeof daten.error === 'string' ? daten.error : (daten.error?.message ?? daten.message ?? '')
  } catch {
    grund = text.trim().slice(0, 200)
  }
  const fehlt = /model\s+['"“]?([^'"”\s]+)['"”]?\s+not found/i.exec(grund)
  if (fehlt) return `Das Modell „${fehlt[1]}“ ist beim Anbieter nicht installiert.`
  if (/does not support tools/i.test(grund)) return 'Dieses Modell kann keine Werkzeuge benutzen.'
  if (status === 401 || status === 403) return 'Der Anbieter verweigert den Zugang — API-Schlüssel prüfen.'
  if (/context|too long|exceeds/i.test(grund)) return `Die Unterhaltung ist zu lang für dieses Modell (${grund}).`
  return grund ? `Anbieter lehnte ab: ${grund}` : `Anbieter lehnte ab (${status})`
}

export async function getJson<T>(
  url: string,
  signal: AbortSignal | undefined,
  headers: Record<string, string> = {}
): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { method: 'GET', signal, headers })
  } catch (e) {
    const err = e as Error
    if (err.name === 'AbortError') throw err
    throw new ProviderError('Anbieter nicht erreichbar', `${url}: ${err.message}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ProviderError('Anbieter lehnte ab', `${res.status} ${res.statusText} ${text.slice(0, 300)}`, res.status)
  }
  return (await res.json()) as T
}
