/**
 * Durchsatz eines Laufs aus Anbietermeldung oder Textlänge.
 *
 * Ollama meldet am Ende `eval_count`, OpenAI-kompatible Anbieter `usage`;
 * beide können schweigen. Dann bleibt nur die Schätzung über die Zeichenlänge
 * — grob vier Zeichen je Token, was für deutsche Prosa in etwa hinhaut.
 */
import type { MessageMetrics } from '@shared/types'

/** Grobe Umrechnung von Zeichen auf Token, falls der Anbieter nichts meldet. */
export const CHARS_PER_TOKEN = 4

export function estimateTokens(chars: number): number {
  return Math.max(0, Math.round(chars / CHARS_PER_TOKEN))
}

export interface MetricsInput {
  /** Tokenzahlen aus der Anbietermeldung, wenn vorhanden. */
  usage?: { input?: number; output?: number }
  /** Länge des erzeugten Antworttextes in Zeichen. */
  chars: number
  /** Vergangene Zeit seit dem Absenden in Millisekunden. */
  durationMs: number
}

/**
 * Rechnet die Anzeige-Werte. Die Zeit wird bewusst als echtes Vergehen
 * gemessen (Absenden bis fertige Antwort), denn das ist das, was am Tisch
 * auffällt — nicht die Rechenzeit, die sich der Anbieter selbst schönrechnet.
 */
export function computeMetrics({ usage, chars, durationMs }: MetricsInput): MessageMetrics {
  const reported = usage?.output ?? 0
  const estimated = !(reported > 0)
  const outputTokens = estimated ? estimateTokens(chars) : reported

  // Ohne Token oder ohne messbare Zeit gibt es keine sinnliche Rate; null
  // wäre hier besser als eine erfundene Zahl, aber die Anzeige mag 0 lieber.
  const seconds = Math.max(durationMs, 1) / 1000
  const perSecond = outputTokens > 0 ? Math.round((outputTokens / seconds) * 10) / 10 : 0

  return {
    outputTokens,
    ...(usage?.input && usage.input > 0 ? { inputTokens: usage.input } : {}),
    durationMs: Math.max(0, Math.round(durationMs)),
    perSecond,
    estimated
  }
}
