import type { ReasoningChoice } from './types'

/** Was tatsächlich auf die Leitung soll. */
export interface DenkRegel {
  /** `undefined` = Feld weglassen, das Modell entscheidet selbst. */
  thinking?: 'off' | 'low' | 'medium' | 'high'
  /** Ob das Modell nachweislich denken kann. */
  supportsThinking: boolean
}

/**
 * Regel für die Denkstufe eines Auftrags.
 *
 * Drei Zustände, drei Bedeutungen — deshalb kein Einschalter:
 *
 * - `auto`  → es wird **nichts** gesendet. Das Modell tut, was es will.
 * - `off`   → dem Modell wird ausdrücklich abgesagt (`think: false`).
 * - eine Stufe → das Modell bekommt die Richtung (Wenig/Mittel/Viel).
 *
 * Die Fähigkeit kommt vom Modell, nicht vom Wunsch: Ollama **lehnt** das Denkfeld
 * bei Modellen ohne Denken ab, statt es zu ignorieren. Wer es trotzdem sendet,
 * sieht eine Fehlermeldung statt einer Antwort.
 */
export function denkRegel(eingaben: {
  bezug?: string
  reasoning: Record<string, ReasoningChoice>
  vorgabe: ReasoningChoice
  faehigkeit?: boolean
}): DenkRegel {
  const { bezug, reasoning, vorgabe, faehigkeit } = eingaben
  const stufe = (bezug ? reasoning[bezug] : undefined) ?? vorgabe
  return {
    thinking: stufe === 'auto' ? undefined : stufe,
    supportsThinking: faehigkeit === true
  }
}

/**
 * Denkbudget je Stufe, in Zeichen des Gedankengangs.
 *
 * Gemessen (Primzahlaufgabe, qwen3.6 über Ollama): „low/medium/high" nimmt die
 * Schnittstelle an, das Modell denkt aber zufällig lang — Hoch dachte weniger
 * als Mittel. Nur gpt-oss kennt echte Stufen. Damit die Stufe bei **jedem**
 * Modell greift, zählt die App mit und kappt: wer sein Budget überschreitet,
 * bevor die Antwort beginnt, antwortet ohne weiteres Nachdenken.
 *
 * `undefined` heißt: ohne Grenze (Hoch, Automatisch, Aus).
 */
export function denkBudget(stufe: 'off' | 'low' | 'medium' | 'high' | undefined): number | undefined {
  if (stufe === 'low') return 1200
  if (stufe === 'medium') return 5000
  return undefined
}

/** Platz für Denken und Antwort zusammen: Hoch braucht mehr, sonst bricht die Antwort ab. */
export function antwortRaum(stufe: 'off' | 'low' | 'medium' | 'high' | undefined): number {
  return stufe === 'high' ? 24576 : 8192
}
