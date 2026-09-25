/**
 * Welche Freiheit sich ein Auftrag nehmen darf.
 *
 * Zwei Regeln halten das in einer vernünftigen Mitte:
 * 1. Ohne Eintrag gilt `ask` — schweigen heißt fragen, nie gewähren.
 * 2. Die Grundeinstellungen des Programms sind die Obergrenze. Wer global
 *    festgelegt hat, dass gar keine Kommandos gelaufen werden sollen, bekommt
 *    sie auch durch die oberste Stufe eines einzelnen Auftrags nicht frei.
 */
import type { PermissionMode, Settings } from '@shared/types'

export interface AccessLimits {
  /** Schreiben im Arbeitsordner ohne Rückfrage. */
  autoApproveWrites: boolean
  /** Kommandos überhaupt zulassen (und dann ohne Rückfrage). */
  allowCommands: boolean
}

export function accessFor(mode: PermissionMode | undefined, base: Pick<Settings, 'autoApproveWrites' | 'allowCommands'>): AccessLimits {
  const level: PermissionMode = mode ?? 'ask'
  return {
    // Ab der mittleren Stufe wird geschrieben; Kommandos bleiben bis zur
    // obersten Stufe eine eigene Frage — ein Löschbefehl ist nicht dasselbe
    // wie eine Datei in einem Ordner, den man selbst gewählt hat.
    autoApproveWrites: base.autoApproveWrites || level === 'autoWrites' || level === 'everything',
    allowCommands: base.allowCommands && level === 'everything'
  }
}
