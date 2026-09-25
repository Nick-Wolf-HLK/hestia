/**
 * Prüft die Zeitlinien-Aufarbeitung: Reihenfolge behalten, Werkzeugblöde
 * bündeln, Aufruf und Ergebnis paarweise, nichts verlieren.
 */
import { describe, expect, it } from 'vitest'
import { buildTimeline, stepDetail, stepKey, summarize } from '../../src/renderer/src/lib/timeline'
import type { ContentPart } from '@shared/types'

const call = (id: string, tool: string, args: unknown = {}): ContentPart => ({ type: 'tool_call', id, tool, args })
const result = (id: string, tool: string, ok = true, output = 'ok'): ContentPart => ({ type: 'tool_result', id, tool, ok, output })

describe('Zeitlinie aus Anteilen', () => {
  it('behält die Reihenfolge: Satz, Block, Satz', () => {
    const entries = buildTimeline([
      { type: 'text', text: 'Ich schaue nach. ' },
      call('a', 'list_dir', { path: '' }),
      result('a', 'list_dir'),
      { type: 'text', text: 'Der Ordner ist leer.' }
    ])

    expect(entries.map((entry) => entry.kind)).toEqual(['text', 'tools', 'text'])
  })

  it('zieht laufende Textbrocken zu einem Absatz zusammen', () => {
    const entries = buildTimeline([
      { type: 'text', text: 'Der Ordner ' },
      { type: 'text', text: 'ist leer.' }
    ])

    expect(entries).toEqual([{ kind: 'text', text: 'Der Ordner ist leer.' }])
  })

  it('bündelt aufeinanderfolgende Werkzeuge zu einem Block mit Paaren', () => {
    const entries = buildTimeline([
      call('a', 'run_command', { command: 'pandoc' }),
      result('a', 'run_command'),
      call('b', 'write_file', { path: 'rede.pdf' }),
      result('b', 'write_file', true, 'Angelegt')
    ])

    expect(entries).toHaveLength(1)
    const block = entries[0]!
    if (block.kind !== 'tools') throw new Error('Erwartet einen Werkzeugblock')
    expect(block.steps).toHaveLength(2)
    expect(block.steps[0]).toMatchObject({ id: 'a', tool: 'run_command', pending: false, ok: true })
    expect(block.steps[1]).toMatchObject({ id: 'b', tool: 'write_file', pending: false, output: 'Angelegt' })
  })

  it('lässt einen laufenden Schritt als laufenden stehen', () => {
    const block = buildTimeline([call('a', 'write_file', { path: 'notiz.md' })])[0]
    if (!block || block.kind !== 'tools') throw new Error('Erwartet einen Werkzeugblock')

    expect(block.steps[0]!.pending).toBe(true)
  })

  it('wirft ein Ergebnis ohne seinen Aufruf nicht weg', () => {
    const block = buildTimeline([result('fremd', 'read_file', false, 'Kein Zugriff')])[0]
    if (!block || block.kind !== 'tools') throw new Error('Erwartet einen Werkzeugblock')

    expect(block.steps).toEqual([{ id: 'fremd', tool: 'read_file', args: undefined, ok: false, output: 'Kein Zugriff', pending: false }])
  })

  it('macht aus zwei Blöcken mit einem Satz dazwischen zwei Blöcke', () => {
    const entries = buildTimeline([
      call('a', 'list_dir'),
      result('a', 'list_dir'),
      { type: 'text', text: 'Zwischenstand.' },
      call('b', 'read_file', { path: 'a.md' })
    ])

    expect(entries.map((entry) => entry.kind)).toEqual(['tools', 'text', 'tools'])
  })

  it('denkt vor den Werkzeugen und nicht dazwischen verstreut', () => {
    const entries = buildTimeline([
      { type: 'thinking', text: 'Erstens ' },
      { type: 'thinking', text: 'zweitens.' },
      call('a', 'list_dir')
    ])

    expect(entries.map((entry) => entry.kind)).toEqual(['thinking', 'tools'])
  })

  it('lässt Durchsatzzeilen aus der Zeitlinie heraus', () => {
    const entries = buildTimeline([
      { type: 'text', text: 'Fertig.' },
      { type: 'metrics', outputTokens: 10, durationMs: 100, perSecond: 100, estimated: false }
    ])

    expect(entries.map((entry) => entry.kind)).toEqual(['text'])
  })
})

describe('Benennung der Schritte', () => {
  it('kennt die eigenen Werkzeuge und fasst unbekannte zusammen', () => {
    expect(stepKey('read_file')).toBe('read_file')
    expect(stepKey('irgendein_fremdes_werkzeug')).toBe('other')
  })

  it('holt den Zielpfad oder das Kommando als Beiwerk', () => {
    expect(stepDetail({ id: 'a', tool: 'read_file', args: { path: 'ordner/notiz.md' }, pending: false })).toBe('ordner/notiz.md')
    expect(stepDetail({ id: 'b', tool: 'run_command', args: { command: 'pandoc', args: ['a.md', '-o', 'a.pdf'] }, pending: false })).toBe(
      'pandoc a.md -o a.pdf'
    )
    expect(stepDetail({ id: 'c', tool: 'search_files', args: { glob: '**/*.md' }, pending: false })).toBe('**/*.md')
  })

  it('kommt mit kaputten Argumenten zurecht', () => {
    expect(stepDetail({ id: 'a', tool: 'write_file', args: undefined, pending: false })).toBe('')
    expect(stepDetail({ id: 'b', tool: 'write_file', args: 'einfacher text', pending: false })).toBe('')
  })
})

describe('Zusammenfassung über einem Block', () => {
  const phrase = (key: string, count: number): string => `${count} ${key}${count === 1 ? '' : 'e'}`

  it('zählt je Art und nennt sie einmal', () => {
    const steps = [
      { id: '1', tool: 'run_command', args: {}, pending: false },
      { id: '2', tool: 'run_command', args: {}, pending: false },
      { id: '3', tool: 'read_file', args: {}, pending: false }
    ]

    expect(summarize(steps, phrase)).toBe('2 run_commande, 1 read_file')
  })

  it('nennt eine einzelne Art ohne Gezähl', () => {
    const steps = [{ id: '1', tool: 'list_dir', args: {}, pending: false }]

    expect(summarize(steps, phrase)).toBe('1 list_dir')
  })
})
