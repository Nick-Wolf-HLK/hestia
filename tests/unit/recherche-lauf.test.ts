/**
 * Der Rechercheverlauf — ohne Netz und ohne Modell.
 *
 * Die Suchseite wird vorgespielt. Geprüft wird der Lauf: mehrere Anfragen,
 * verschiedene Seiten, Nummer an jeder Notiz, und ein Fehler pro Seite statt
 * einer Abbruchlawine.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const suchen = vi.fn()
const leseSeite = vi.fn()
vi.mock('../../src/main/research/web', () => ({
  RechercheFehler: class extends Error {},
  suchen: (begriff: string, opts: { höchste?: number }) => suchen(begriff, opts),
  leseSeite: (url: string, opts: { zeichen?: number }) => leseSeite(url, opts)
}))

const { anfragenBildern, berichtGrundlage, recherchiere } = await import('../../src/main/research/index')

function fund(url: string, titel = url) {
  return { titel, url, text: `Begleittext zu ${titel}` }
}

beforeEach(() => {
  suchen.mockReset()
  leseSeite.mockReset()
})

describe('Anfragen bauen', () => {
  it('lässt die Anrede weg und behält die Frage', () => {
    const fragen = anfragenBildern('Recherchiere bitte: Was kostet ein Dach mit 40 Modulen?')
    expect(fragen[0]).toBe('Recherchiere bitte: Was kostet ein Dach mit 40 Modulen?')
    expect(fragen.some((frage) => frage.startsWith('Was kostet'))).toBe(true)
    expect(fragen.length).toBeLessThanOrEqual(4)
  })

  it('erfindet keine leeren Anfragen', () => {
    expect(anfragenBildern('   ')).toEqual([])
  })
})

describe('der Rechercheverlauf', () => {
  it('liest verschiedene Seiten und nummeriert die Quellen', async () => {
    let anfragen = 0
    suchen.mockImplementation(async () => {
      anfragen += 1
      // Die zweite Anfrage wirft andere Seiten raus als die erste — und eine bekannte dazwischen.
      return anfragen === 1 ? [fund('https://a.example'), fund('https://c.example')] : [fund('https://b.example'), fund('https://a.example')]
    })
    leseSeite.mockImplementation(async (url: string) => `Sehr viel Text von ${url}`)
    const ergebnis = await recherchiere('Was kostet ein Dach mit 40 Modulen', { seitenHöchstzahl: 3 })
    expect(ergebnis.fragen.length).toBeGreaterThan(1)
    expect(ergebnis.notizen.map((notiz) => notiz.fund.url).sort()).toEqual(['https://a.example', 'https://b.example', 'https://c.example'])
    expect(leseSeite).toHaveBeenCalledTimes(3)

    const grundlage = berichtGrundlage(ergebnis)
    expect(grundlage).toContain('[1]')
    expect(grundlage).toContain('Quellenverzeichnis')
    // Jede Adresse genau einmal im Verzeichnis.
    const verzeichnis = grundlage.slice(grundlage.indexOf('Quellenverzeichnis:'))
    const zeilen = verzeichnis.split('\n').filter((zeile) => zeile.includes('https://a.example'))
    expect(zeilen).toHaveLength(1)
    expect(zeilen[0]).toContain('[1]')
  })

  it('merkt eine unlesbare Seite, statt den Lauf zu killen', async () => {
    suchen.mockResolvedValue([fund('https://kaputt.example'), fund('https://gut.example')])
    leseSeite.mockImplementation(async (url: string) => {
      if (url.includes('kaputt')) throw new Error('Seite antwortet nicht')
      return `Text von ${url}`
    })
    const ergebnis = await recherchiere('Frage', { seitenHöchstzahl: 2 })
    expect(ergebnis.notizen).toHaveLength(1)
    expect(ergebnis.gemeldeteFehler.join(' ')).toContain('kaputt')
  })

  it('bricht ab, wenn die erste Anfrage nichts fischt', async () => {
    suchen.mockRejectedValue(new Error('Suchseite bremst'))
    await expect(recherchiere('Frage')).rejects.toThrow('Suchseite bremst')
  })

  it('meldet den Fortschritt als abarbeitbare Punkte', async () => {
    suchen.mockResolvedValue([fund('https://a.example')])
    leseSeite.mockResolvedValue('Text')
    // Je Meldung: wie viele Punkte schon erledigt sind.
    const stände: number[] = []
    await recherchiere('Frage', {
      seitenHöchstzahl: 1,
      fortschritt: (punkte) => stände.push(punkte.filter((punkt) => punkt.done).length)
    })
    expect(stände.length).toBeGreaterThan(2)
    expect(stände[stände.length - 1]!).toBeGreaterThan(stände[0]!)
  })
})
