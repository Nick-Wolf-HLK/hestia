/**
 * Prüft die Regel, nach der Antworttext in die sichtbare Reihenfolge kommt.
 * Der Fehler, der dazu führte: drei Sätze aus drei Schritten klebten zu einem —
 * „…zu verstehen.Der Ordner ist leer…" — weil jeder Nachtrag an den ersten
 * Textanteil gehängt wurde.
 */
import { describe, expect, it } from 'vitest'
import { appendTextPart } from '../../src/shared/parts'
import type { ContentPart } from '@shared/types'

const tool: ContentPart = { type: 'tool_call', id: 'r1', tool: 'write_file', args: { path: 'a.md' } }
const result: ContentPart = { type: 'tool_result', id: 'r1', tool: 'write_file', ok: true, output: 'Anglegt: a.md' }

describe('Text in Reihenfolge einreihen', () => {
  it('hängt an, solange der letzte Anteil Text ist', () => {
    let parts: ContentPart[] = []
    parts = appendTextPart(parts, 'Ich schaue ')
    parts = appendTextPart(parts, 'mir den Ordner an.')

    expect(parts).toEqual([{ type: 'text', text: 'Ich schaue mir den Ordner an.' }])
  })

  it('fängt nach einem Werkzeugblock einen eigenen Textanteil an', () => {
    let parts: ContentPart[] = appendTextPart([], 'Der Ordner ist leer.')
    parts = [...parts, tool, result]
    parts = appendTextPart(parts, 'Ich lege eine Datei an.')

    expect(parts.map((part) => part.type)).toEqual(['text', 'tool_call', 'tool_result', 'text'])
    expect(parts[3]).toEqual({ type: 'text', text: 'Ich lege eine Datei an.' })
  })

  it('lässt drei Schritte als drei Sätze lesen', () => {
    const texte = ['Ich schaue mir den Ordner an.', 'Der Ordner ist leer, ich lege an.', 'Fertig: notiz.md exists.']
    let parts: ContentPart[] = []
    for (const [index, text] of texte.entries()) {
      if (index > 0) parts = [...parts, { ...tool, id: `r${index}` }, { ...result, id: `r${index}` }]
      // Ein Schritt streamed in mehreren Brocken.
      for (const brocken of text.split(' ')) parts = appendTextPart(parts, brocken + ' ')
    }

    const antworten = parts.filter((part) => part.type === 'text').map((part) => (part.type === 'text' ? part.text : ''))
    expect(antworten).toHaveLength(3)
    // Kein Aneinanderlaufen: jeder Satz endet mit Leerzeichen, beginnt aber neu.
    expect(antworten.join('').includes('an.Der')).toBe(false)
    expect(antworten[1]!.startsWith('Der Ordner')).toBe(true)
  })

  it('lässt andere Anteile unverändert', () => {
    const vorher: ContentPart[] = [tool, result]
    expect(appendTextPart(vorher, 'Danach.').slice(0, 2)).toEqual(vorher)
  })

  it('verändert die übergebene Folge nicht', () => {
    const vorher: ContentPart[] = [{ type: 'text', text: 'A' }]
    appendTextPart(vorher, 'B')

    expect(vorher).toEqual([{ type: 'text', text: 'A' }])
  })
})
