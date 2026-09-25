import type { ContentPart } from './types'

/**
 * Text in eine Teilchenfolge einreihen: läuft der Text weiter, wird er an den
 * letzten Textanteil gehängt; liegt zuletzt etwas anderes (ein Werkzeugblock),
 * fängt ein eigener Textanteil an.
 *
 * Ohne diese Regel klebt die Erzählung mehrerer Schritte zu einem Satz
 * zusammen und die Reihenfolge der Blöcke verliert ihren Sinn. Beide Seiten —
 * Hauptprozess beim Persistieren und Oberfläche beim Mitleben des Stroms —
 * benutzen deshalb ein und dieselbe Funktion.
 */
export function appendTextPart(parts: ContentPart[], text: string): ContentPart[] {
  const last = parts[parts.length - 1]
  if (last && last.type === 'text') {
    const merged: ContentPart = { type: 'text', text: last.text + text }
    return [...parts.slice(0, -1), merged]
  }
  return [...parts, { type: 'text', text }]
}
