/**
 * Prüfungen der Wörterbücher. Zwei Dinge sind hier leicht kaputt und bleiben
 * sonst unbemerkt: ein Schlüssel fehlt in einer Sprache, oder eine Ansicht hat
 * keinen Titel und zeigt dann ihr Interna-Wort in der Titelleiste.
 */
import { describe, expect, it } from 'vitest'
import { strings } from '../../src/renderer/src/i18n'

/** Jede Ansicht braucht einen Titel; die Namen stehen im Laden. */
const VIEWS = ['home', 'chat', 'projects', 'artifacts', 'scheduled', 'dispatch', 'customize'] as const

const asDict = (language: 'de' | 'en'): Record<string, string> => strings[language]
const keysOf = (language: 'de' | 'en'): string[] => Object.keys(asDict(language))

describe('Wörterbücher', () => {
  it('haben in beiden Sprachen dieselben Schlüssel', () => {
    const de = keysOf('de')
    const en = keysOf('en')
    const nurDe = de.filter((key) => !en.includes(key))
    const nurEn = en.filter((key) => !de.includes(key))

    expect({ nurDe, nurEn }).toEqual({ nurDe: [], nurEn: [] })
    expect(de.length).toBeGreaterThan(100)
  })

  it('haben für jede Ansicht einen Titel in beiden Sprachen', () => {
    for (const view of VIEWS) {
      for (const language of ['de', 'en'] as const) {
        const key = `view.${view}`
        const value = asDict(language)[key]
        // Ein fehlender Wert wäre `undefined`, der Wert den Schlüssel selbst
        // zu zeigen ist dasselbe Übel.
        expect(value, `${language}/${key}`).toBeTruthy()
        expect(value, `${language}/${key}`).not.toBe(key)
      }
    }
  })

  it('haben keine leeren Übersetzungen', () => {
    const empty = keysOf('de').filter((key) => !asDict('de')[key]?.trim() || !asDict('en')[key]?.trim())

    expect(empty).toEqual([])
  })

  it('setzen Platzhalter in beiden Sprachen gleich oft ein', () => {
    const offenders = keysOf('de').filter((key) => {
      const de = (asDict('de')[key]?.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(',')
      const en = (asDict('en')[key]?.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(',')
      return de !== en
    })

    expect(offenders).toEqual([])
  })
})
