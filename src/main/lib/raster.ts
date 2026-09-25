/** Nur Felder, die es wirklich gibt. */
import { DEFAULT_SETTINGS, type Settings } from '../../shared/types'

/**
 * Ein Schlüssel aus einer alten Fassung überlebt sonst als scheinbar vorhandene
 * Einstellung: `get()` zeigt ihn, die Schreibprüfung wirft ihn still weg — und
 * kein Setzen erreicht ihn je wieder. Gesehen an einem Feld, das in keinem
 * Quelltext mehr vorkam, aber in jedem Lesevorgang zurückkam.
 */
export function bekannteFelder(einstellung: Record<string, unknown>): Partial<Settings> {
  const vorhanden = new Set(Object.keys(DEFAULT_SETTINGS))
  return Object.fromEntries(Object.entries(einstellung).filter(([feld]) => vorhanden.has(feld))) as Partial<Settings>
}
