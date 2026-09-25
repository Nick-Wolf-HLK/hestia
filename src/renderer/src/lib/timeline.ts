import type { ContentPart } from '@shared/types'

/**
 * Ein Schritt, wie er in der Zeitlinie sichtbar wird: Aufruf und — wenn
 * vorhanden — das dazugehörige Ergebnis, an einem Stück.
 */
export interface ToolStep {
  id: string
  tool: string
  args: unknown
  ok?: boolean
  output?: string
  /** Wartet noch auf das Ergebnis. */
  pending: boolean
}

export type TimelineEntry =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tools'; steps: ToolStep[] }
  | { kind: 'image'; mediaType: string; dataBase64: string; name?: string }
  | { kind: 'file'; name: string; text: string }
  | { kind: 'document'; path: string; title: string; documentKind: string; bytes?: number }

/**
 * Anteile in der Reihenfolge aufarbeiten, in der sie geschahen.
 *
 * Zwei Regeln machen den Unterschied:
 * 1. Aufeinanderfolgende Text- oder Denkanteile werden zu einem Absatz
 *    zusammengezogen (sie stammen aus demselmen Strom).
 * 2. Aufeinanderfolgende Werkzeuganteile werden zu EINEM Block mit Schritten
 *    gebündelt, Aufruf und Ergebnis paarweise. Einzelne Ergebnisse ohne ihren
 *    Aufruf bleiben als eigene Schritte stehen — verloren geht nichts.
 */
export function buildTimeline(parts: ContentPart[]): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  /** Der gerade offene Werkzeugblock, falls der vorige Anteil einer war. */
  let openTools: ToolStep[] | null = null

  const closeTools = (): void => {
    if (openTools && openTools.length > 0) entries.push({ kind: 'tools', steps: openTools })
    openTools = null
  }

  for (const part of parts) {
    if (part.type === 'tool_call') {
      if (!openTools) openTools = []
      openTools.push({ id: part.id, tool: part.tool, args: part.args, pending: true })
      continue
    }

    if (part.type === 'tool_result') {
      if (!openTools) openTools = []
      const step = openTools.find((candidate) => candidate.id === part.id)
      if (step) {
        step.ok = part.ok
        step.output = part.output
        step.pending = false
      } else {
        openTools.push({ id: part.id, tool: part.tool, args: undefined, ok: part.ok, output: part.output, pending: false })
      }
      continue
    }

    closeTools()

    if (part.type === 'text') {
      const last = entries[entries.length - 1]
      if (last && last.kind === 'text') last.text += part.text
      else entries.push({ kind: 'text', text: part.text })
      continue
    }

    if (part.type === 'thinking') {
      const last = entries[entries.length - 1]
      if (last && last.kind === 'thinking') last.text += part.text
      else entries.push({ kind: 'thinking', text: part.text })
      continue
    }

    if (part.type === 'image') entries.push({ kind: 'image', mediaType: part.mediaType, dataBase64: part.dataBase64, name: part.name })
    else if (part.type === 'file') entries.push({ kind: 'file', name: part.name, text: part.text })
    else if (part.type === 'document')
      entries.push({ kind: 'document', path: part.path, title: part.title, documentKind: part.kind, bytes: part.bytes })
    // `metrics` hat keinen Platz in der Zeitlinie; die Anzeige hängt am Ende.
  }

  closeTools()
  return entries
}

/** Werkzeuge, für die es eine eigene Formulierung gibt. */
const PHRASED = new Set([
  'list_dir', 'read_file', 'search_files', 'write_file', 'edit_file', 'run_command', 'create_document', 'todo',
  'erinnerung_merken', 'erinnerung_aendern', 'erinnerung_loeschen', 'projekt_durchsuchen', 'projekt_datei_lesen',
  'dokument_lesen', 'dokument_bearbeiten', 'dokument_wiederherstellen', 'chats_durchsuchen', 'letzte_chats', 'websuche', 'webseite_lesen', 'recherche'
])

/** Der Schlüssel, unter dem die Oberfläche den Schritt benennt. */
export function stepKey(tool: string): string {
  return PHRASED.has(tool) ? tool : 'other'
}

/**
 * Knapp halten, was ein Schritt tat: Der Zielpfad oder das Kommando daneben,
 * nicht der ganze Argumenthaufen.
 */
export function stepDetail(step: ToolStep): string {
  const args = step.args
  if (!args || typeof args !== 'object') return ''
  const record = args as Record<string, unknown>
  const pick = (key: string): string => (typeof record[key] === 'string' ? (record[key] as string) : '')

  switch (stepKey(step.tool)) {
    case 'run_command': {
      const program = pick('command')
      const rest = Array.isArray(record.args) ? (record.args as unknown[]).filter((a) => typeof a === 'string').join(' ') : ''
      return [program, rest].filter(Boolean).join(' ').slice(0, 80)
    }
    case 'search_files':
      return pick('glob') || pick('pattern') || pick('query')
    case 'todo':
      return ''
    case 'erinnerung_merken':
    case 'erinnerung_aendern':
      return pick('text').slice(0, 80)
    case 'erinnerung_loeschen':
      return ''
    case 'projekt_durchsuchen':
      return pick('anfrage')
    case 'projekt_datei_lesen':
      return pick('datei')
    case 'chats_durchsuchen':
    case 'websuche':
      return pick('anfrage')
    case 'webseite_lesen':
      return pick('url')
    case 'recherche':
      return pick('frage')
    case 'letzte_chats':
      return ''
    case 'dokument_lesen':
    case 'dokument_bearbeiten':
    case 'dokument_wiederherstellen':
      return pick('dokument')
    default:
      return pick('path') || pick('file') || pick('name')
  }
}

/**
 * Eine Zeile über dem Block, die sagt, was hier insgesamt geschah — damit
 * sechs Werkzeugzeilen nicht wie sechs Mysterien aussehen.
 */
export function summarize(steps: ToolStep[], phrase: (key: string, count: number) => string): string {
  const counts = new Map<string, number>()
  // Gezählt wird, was geschehen ist: ein Schritt, der noch wartet oder
  // abgelehnt wurde, hat kein Dokument erstellt und keine Datei geschrieben.
  for (const step of steps) {
    if (step.pending || step.ok === false) continue
    const key = stepKey(step.tool)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].map(([key, count]) => phrase(key, count)).join(', ')
}
