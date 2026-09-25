/**
 * Frühere Chats durchsuchen und darauf verweisen.
 *
 * Das Modell bekommt zwei Werkzeuge: `chats_durchsuchen` (Stichwörter) und
 * `letzte_chats` (die jüngsten Gespräche, auf Wunsch in einem Zeitraum). Der
 * Bereich folgt einer festen Regel: in einem Projekt nur dessen Chats, sonst nur
 * die Chats ohne Projekt. Der fragende Chat selbst ist nie dabei — den kennt
 * das Modell ohnehin.
 */
import type { Chat, Settings } from '@shared/types'
import type { ToolSpec } from './providers/types'
import type { ToolRuntime } from './chat'
import type { Store } from './db'

const SPEZ_SUCHEN: ToolSpec = {
  name: 'chats_durchsuchen',
  description:
    'Durchsucht frühere Chats der Nutzer:in nach Stichwörtern und liefert passende Auszüge mit Chat-Titel und Datum. ' +
    'Für „wie wir neulich besprochen haben“, „was hatte ich dir über … erzählt“ oder wenn Wissen aus früheren Gesprächen hilft.',
  parameters: {
    type: 'object',
    properties: {
      anfrage: { type: 'string', description: 'Aussagekräftige Stichwörter (Namen, Fachbegriffe), keine ganzen Sätze' },
      seit: { type: 'string', description: 'Optional: nur ab diesem Tag, JJJJ-MM-TT' },
      bis: { type: 'string', description: 'Optional: nur bis zu diesem Tag, JJJJ-MM-TT' }
    },
    required: ['anfrage'],
    additionalProperties: false
  }
}

const SPEZ_LETZTE: ToolSpec = {
  name: 'letzte_chats',
  description:
    'Listet die jüngsten früheren Chats mit erster Frage und letzter Antwort — für „worüber haben wir zuletzt gesprochen“ ' +
    'oder „was war letzte Woche“. Mit seit/bis auf einen Zeitraum eingrenzen.',
  parameters: {
    type: 'object',
    properties: {
      anzahl: { type: 'number', description: 'Wie viele (1–20, Standard 8)' },
      seit: { type: 'string', description: 'Optional: ab diesem Tag, JJJJ-MM-TT' },
      bis: { type: 'string', description: 'Optional: bis zu diesem Tag, JJJJ-MM-TT' }
    },
    additionalProperties: false
  }
}

/** Die Werkzeuge sind da — dann steht auch eine kurze Regel im Systemprompt. */
export function verlaufTeile(chat: Chat, mitWerkzeugen: boolean): string[] {
  if (!mitWerkzeugen) return []
  return [
    `Du kannst frühere Chats ${chat.projectId ? 'dieses Projekts' : 'der Nutzer:in (außerhalb von Projekten)'} durchsuchen: chats_durchsuchen und letzte_chats. ` +
      'Nutze das, wenn die Nutzer:in sich auf Früheres bezieht („wie neulich“, „letzte Woche“, „weißt du noch“) oder wenn dort offensichtlich ' +
      'nötiges Wissen steht. Sag dazu, aus welchem Chat die Information stammt. Ohne solchen Anlass nicht suchen.'
  ]
}

/** „2026-09-12“ → Anfang bzw. Ende dieses Tages in Millisekunden. */
function tag(wert: unknown, ende: boolean): number | undefined {
  if (typeof wert !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(wert.trim())) return undefined
  const [j, m, t] = wert.trim().split('-').map(Number) as [number, number, number]
  const datum = ende ? new Date(j, m - 1, t, 23, 59, 59, 999) : new Date(j, m - 1, t, 0, 0, 0, 0)
  return Number.isNaN(datum.getTime()) ? undefined : datum.getTime()
}

function wann(ms: number): string {
  return new Date(ms).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export interface VerlaufKontext {
  store: Store
  chat: Chat
  settings: Settings
}

/** Legt die Verlaufswerkzeuge um einen Werkzeugkasten — wenn die Einstellung es erlaubt. */
export function mitVerlauf(runtime: ToolRuntime | undefined, ctx: VerlaufKontext): ToolRuntime | undefined {
  if (!ctx.settings.chatsDurchsuchen) return runtime
  const bereich = { projectId: ctx.chat.projectId, ausser: ctx.chat.id }

  const ausfuehren = (name: string, args: Record<string, unknown>): { ok: boolean; output: string } | undefined => {
    if (name === SPEZ_SUCHEN.name) {
      const anfrage = typeof args.anfrage === 'string' ? args.anfrage : ''
      const treffer = ctx.store.sucheInChats(anfrage, { ...bereich, seit: tag(args.seit, false), bis: tag(args.bis, true) })
      if (treffer.length === 0) return { ok: true, output: 'Keine passenden früheren Chats gefunden. Andere Stichwörter versuchen oder letzte_chats nutzen.' }
      return {
        ok: true,
        output: treffer
          .map(
            (t) =>
              `## Chat „${t.titel}“ (zuletzt ${wann(t.zuletzt)})\n` +
              t.auszuege.map((a) => `[${a.rolle === 'user' ? 'Nutzer:in' : 'Assistent'}, ${wann(a.zeit)}] ${a.text}`).join('\n\n')
          )
          .join('\n\n---\n\n')
      }
    }
    if (name === SPEZ_LETZTE.name) {
      const anzahl = typeof args.anzahl === 'number' ? Math.floor(args.anzahl) : undefined
      const liste = ctx.store.letzteChats({ ...bereich, anzahl, seit: tag(args.seit, false), bis: tag(args.bis, true) })
      if (liste.length === 0) return { ok: true, output: 'Keine früheren Chats in diesem Zeitraum.' }
      return {
        ok: true,
        output: liste
          .map((c) => `- „${c.titel}“ (${wann(c.zuletzt)})\n  Frage: ${c.frage || '—'}\n  Letzte Antwort: ${c.antwort || '—'}`)
          .join('\n')
      }
    }
    return undefined
  }

  return {
    specs: [...(runtime?.specs ?? []), SPEZ_SUCHEN, SPEZ_LETZTE],
    maxSteps: runtime?.maxSteps,
    async execute(callId, name, args) {
      try {
        const eigenes = ausfuehren(name, (args ?? {}) as Record<string, unknown>)
        if (eigenes) return eigenes
      } catch (e) {
        return { ok: false, output: (e as Error).message }
      }
      if (!runtime) return { ok: false, output: `Unbekanntes Werkzeug: ${name}` }
      return runtime.execute(callId, name, args)
    }
  }
}
