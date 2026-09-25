/**
 * Die Tiefenrecherche als Ablauf: Plan, Suchen, Auswerten, Lücken, zweite Runde.
 * Suchmaschine und Modell sind hier nachgestellt — geprüft wird die Führung.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/main/research/web', () => {
  class RechercheFehler extends Error {}
  return {
    RechercheFehler,
    suchen: vi.fn(async (anfrage: string) => [
      { titel: `Treffer A zu ${anfrage}`, url: `https://a.example/${encodeURIComponent(anfrage)}`, text: '' },
      { titel: `Treffer B zu ${anfrage}`, url: `https://b.example/${encodeURIComponent(anfrage)}`, text: '' },
      { titel: 'Immer derselbe', url: 'https://gleich.example/seite', text: '' }
    ]),
    leseSeite: vi.fn(async (url: string) => `Inhalt der Seite ${url}. Eine Zahl: 42.`)
  }
})

import { auswertungsAufgabe, jsonAus, planLesen, seitenKern, seitenWaehlen, tiefenrecherche, tiefGrundlage } from '../../src/main/research/tief'

describe('Bausteine', () => {
  it('liest JSON auch mit Text und Denkblock drumherum', () => {
    expect(jsonAus<{ a: number }>('<think>{kaputt</think> Hier: ```json\n{"a": 1, "b": "x}y"}\n``` fertig')).toEqual({ a: 1, b: 'x}y' })
    expect(jsonAus('kein json')).toBeUndefined()
  })

  it('kürzt den Plan gleichmäßig und fällt ohne Plan auf die Frage zurück', () => {
    const antwort = JSON.stringify({ teilfragen: [{ frage: 'A', suchen: ['anfrage a1', 'anfrage a2', 'anfrage a3', 'anfrage a4'] }, { frage: 'B', suchen: ['anfrage b1'] }] })
    const plan = planLesen(antwort, 'Frage', 3)
    expect(plan.map((t) => t.suchen.length)).toEqual([2, 1])
    expect(planLesen('Unsinn', 'Wie hoch ist der Mount Everest?', 4)[0]!.suchen.length).toBeGreaterThan(0)
  })

  it('wählt reihum aus den Teilfragen, jede Adresse einmal, höchstens zwei je Website', () => {
    const funde = [
      { titel: '1', url: 'https://x.de/1', text: '', teilfrage: 0 },
      { titel: '2', url: 'https://x.de/2', text: '', teilfrage: 0 },
      { titel: '3', url: 'https://x.de/3', text: '', teilfrage: 0 },
      { titel: '4', url: 'https://y.de/1', text: '', teilfrage: 1 },
      { titel: '5', url: 'https://x.de/1', text: '', teilfrage: 1 }
    ]
    const gewaehlt = seitenWaehlen(funde, 10, new Set())
    expect(gewaehlt.map((f) => f.url)).toEqual(['https://x.de/1', 'https://y.de/1', 'https://x.de/2'])
    expect(seitenWaehlen(funde, 10, new Set(['https://x.de/1'])).map((f) => f.url)).not.toContain('https://x.de/1')
  })
})

describe('Seiten auswerten', () => {
  it('nimmt Menüs und Knöpfe heraus und lässt den Artikel stehen', () => {
    const seite = 'Navigation\nSuche\nMitglied werden\nKontakt\nDer Klimageschwindigkeitsbonus beträgt jetzt nur noch 16 Prozent für selbstnutzende Eigentümer.\nStand: 21.07.2026\nMenü'
    expect(seitenKern(seite)).toBe('Der Klimageschwindigkeitsbonus beträgt jetzt nur noch 16 Prozent für selbstnutzende Eigentümer.')
    expect(seitenKern('Förderung ab 1. Februar 2027: 28.000 €')).toBe('Förderung ab 1. Februar 2027: 28.000 €')
  })

  it('stellt die Aufgabe hinter den Seitentext und erlaubt IRRELEVANT nur für leere Seiten', () => {
    const aufgabe = auswertungsAufgabe('Wie hoch ist die Förderung?', 'Fördersätze')
    expect(aufgabe.startsWith('AUFGABE:')).toBe(true)
    expect(aufgabe).toMatch(/Nur wenn die Seite gar nichts zum Thema enthält/)
  })
})

describe('Ablauf', () => {
  it('plant, sucht, wertet aus, schließt Lücken und nummeriert die Quellen', async () => {
    const schritte: string[] = []
    let zaehler = 0
    const fragModell = vi.fn(async (system: string) => {
      if (system.startsWith('Du planst')) {
        return JSON.stringify({ teilfragen: [{ frage: 'Geschichte', suchen: ['geschichte eins', 'geschichte zwei'] }, { frage: 'Heute', suchen: ['heute eins'] }] })
      }
      if (system.startsWith('Du prüfst')) return JSON.stringify({ luecken: 'Heute ist dünn', suchen: ['heute zwei'] })
      // Auswertung: jede zweite Seite ist unbrauchbar.
      return ++zaehler % 2 === 0 ? 'IRRELEVANT' : '- Die Zahl ist 42.'
    })
    const ergebnis = await tiefenrecherche('Was ist mit 42?', {
      fragModell,
      schritte: {
        beginn: (tool) => {
          schritte.push(tool)
          return `id-${schritte.length}`
        },
        ende: () => undefined
      },
      seitenErsteRunde: 4,
      seitenLueckenrunde: 2,
      suchPause: 0
    })
    expect(schritte[0]).toBe('tiefenrecherche_plan')
    expect(schritte.filter((s) => s === 'websuche')).toHaveLength(4)
    expect(schritte).toContain('tiefenrecherche_luecken')
    expect(schritte.filter((s) => s === 'webseite_lesen').length).toBe(ergebnis.gelesen)
    expect(ergebnis.suchen).toBe(4)
    expect(ergebnis.quellen.map((q) => q.nummer)).toEqual(ergebnis.quellen.map((_, i) => i + 1))
    expect(ergebnis.quellen.every((q) => q.notizen.includes('42'))).toBe(true)
    // Dieselbe Adresse wird nie zweimal gelesen.
    expect(new Set(ergebnis.quellen.map((q) => q.url)).size).toBe(ergebnis.quellen.length)

    const grundlage = tiefGrundlage(ergebnis)
    expect(grundlage).toContain('Teilfragen:\n1. Geschichte\n2. Heute')
    expect(grundlage).toContain('Quellenverzeichnis:\n[1]')
  })

  it('wartet und versucht es erneut, wenn die Suchmaschine bremst', async () => {
    const web = await import('../../src/main/research/web')
    const suchen = vi.mocked(web.suchen)
    suchen.mockRejectedValueOnce(new web.RechercheFehler('Die Suchseite bremst gerade. Kurze Pause, dann erneut versuchen.'))
    const schritte: Array<{ tool: string; ok: boolean }> = []
    await tiefenrecherche('Frage mit Bremse', {
      fragModell: async (system) => (system.startsWith('Du planst') ? JSON.stringify({ teilfragen: [{ frage: 'Eins', suchen: ['erste anfrage'] }] }) : system.startsWith('Du prüfst') ? '{"suchen":[]}' : '- Fakt'),
      schritte: { beginn: (tool) => tool, ende: (_id, tool, ok) => schritte.push({ tool, ok }) },
      suchPause: 0,
      bremsPausen: [1],
      seitenErsteRunde: 1
    })
    // Die gebremste Suche ist nach der Pause gelungen.
    expect(schritte.filter((s) => s.tool === 'websuche')).toEqual([{ tool: 'websuche', ok: true }])
  })

  it('zählt eine leere Auswertung als Fehler, nicht als unbrauchbare Seite', async () => {
    const schritte: Array<{ tool: string; ok: boolean; output: string }> = []
    await expect(
      tiefenrecherche('Leer', {
        fragModell: async (system) => (system.startsWith('Du planst') ? JSON.stringify({ teilfragen: [{ frage: 'Eins', suchen: ['leere anfrage'] }] }) : system.startsWith('Du prüfst') ? '{"suchen":[]}' : ''),
        schritte: { beginn: (tool) => tool, ende: (_id, tool, ok, output) => schritte.push({ tool, ok, output }) },
        suchPause: 0,
        seitenErsteRunde: 2
      })
    ).rejects.toThrow(/keine brauchbare Quelle/)
    expect(schritte.filter((s) => s.tool === 'webseite_lesen').every((s) => !s.ok && /Keine Auswertung/.test(s.output))).toBe(true)
  })

  it('bricht ab, wenn der Lauf gestoppt wird', async () => {
    const stopp = new AbortController()
    stopp.abort()
    await expect(
      tiefenrecherche('Frage', {
        fragModell: async () => '{}',
        schritte: { beginn: () => 'x', ende: () => undefined },
        signal: stopp.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
