/**
 * Die Verträge unter der Oberfläche.
 *
 * Vier Klassen stiller Fehler sind hier versammelt — alle vier sind schon
 * aufgetreten und haben sich nie gemeldet, weil niemand nachgeschaut hat:
 *
 * 1. Ein Einstellungsfeld, das die Prüfung in der Hauptseite nicht kennt:
 *    speichern schlägt fehl oder der Wert verschwindet, ohne dass etwas zu
 *    sehen ist (`keepAwake`, die beiden Vorschauwerte, `startView`).
 * 2. Ein Kanal ohne Empfänger: der Knopf ruft, niemand antwortet.
 * 3. Eine Brücke, die einen Kanal anruft, den es nicht gibt.
 * 4. Ein fehlender Wörterbuchschlüssel: im Deutschen steht der englische Text
 *    oder der Schlüssel selbst.
 *
 * Diese Prüfung läuft gegen die **echten Dateien**, nicht gegen eine Abschrift.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/types'
import { settingsSchema } from '../../src/main/ipc'
import { Channels } from '../../src/shared/ipc'
import { strings } from '../../src/renderer/src/i18n'

const de = strings.de as Record<string, string>
const en = strings.en as Record<string, string>

function quellen(verzeichnis: string, out: string[] = []): string[] {
  for (const eintrag of readdirSync(verzeichnis)) {
    if (eintrag === 'node_modules' || eintrag.startsWith('.')) continue
    const pfad = join(verzeichnis, eintrag)
    if (statSync(pfad).isDirectory()) quellen(pfad, out)
    else if (/\.tsx?$/.test(pfad)) out.push(pfad)
  }
  return out
}

// Die Hauptseite als Ganzes: ein Kanal darf auch in einer andern Datei
// enden (Fensterereignisse werden gesandt, nicht empfangen).
const HAUPTTEXT = quellen('src/main').map((pfad) => readFileSync(pfad, 'utf8')).join('\n')
const BRUECKENTEXT = readFileSync('src/shared/desk-api.ts', 'utf8')
const WUERTER = quellen('src/renderer/src').map((pfad) => ({ pfad, text: readFileSync(pfad, 'utf8') }))

describe('die Verträge', () => {
  it('kennen für jedes Einstellungsfeld auch eine Prüfung', () => {
    const geprueft = Object.keys(settingsSchema.shape)
    for (const feld of Object.keys(DEFAULT_SETTINGS)) {
      expect(geprueft, `„${feld}" steht in den Einstellungen, wird aber beim Speichern still verworfen`).toContain(feld)
    }
  })

  it('haben jeden Kanal auch einen Empfänger in der Hauptseite', () => {
    for (const [name, kanal] of Object.entries(Channels)) {
      expect(HAUPTTEXT, `der Kanal „${name}" (${kanal}) hat keinen Empfänger`).toContain(`Channels.${name}`)
    }
  })

  it('ruft die Brücke nur Kanäle auf, die es gibt', () => {
    const bekannte = new Set(Object.keys(Channels))
    const benutzte = [...BRUECKENTEXT.matchAll(/Channels\.([a-zA-Z]+)/g)].map((treffer) => treffer[1] as string)
    for (const name of benutzte) {
      expect(bekannte.has(name), `die Brücke nennt „${name}", aber der Kanal ist nicht definiert`).toBe(true)
    }
    expect(benutzte.length).toBeGreaterThan(20)
  })

  it('hat jede Brückenmethode einen Kanal, der in der Hauptseite endet', () => {
    for (const name of Object.keys(Channels)) {
      const inDerBruecke = BRUECKENTEXT.includes(`Channels.${name}`)
      const inDerHauptseite = HAUPTTEXT.includes(`Channels.${name}`)
      // Ein Kanal darf in eine Richtung fehlen (nur senden oder nur empfangen),
      // aber er darf nirgends fehlen.
      expect(inDerBruecke || inDerHauptseite, `„${name}" wird von niemandem benutzt`).toBe(true)
    }
  })

  it('haben beide Sprachen denselben Schlüsselbestand', () => {
    const deutsche = Object.keys(de).sort()
    const englische = Object.keys(en).sort()
    const fehltInEnglisch = deutsche.filter((schluessel) => !(schluessel in en))
    const fehltInDeutsch = englische.filter((schluessel) => !(schluessel in de))
    expect(fehltInEnglisch, `in Englisch fehlt: ${fehltInEnglisch.join(', ')}`).toEqual([])
    expect(fehltInDeutsch, `in Deutsch fehlt: ${fehltInDeutsch.join(', ')}`).toEqual([])
  })

  it('benutzt nur Schlüssel, die es auch gibt', () => {
    const benutzt = new Set<string>()
    for (const { text } of WUERTER) {
      for (const treffer of text.matchAll(/\bt\(\s*'([a-zA-Z][a-zA-Z0-9.]*)'/g)) benutzt.add(treffer[1] as string)
    }
    // Zusammengesetzte Schlüssel (`t(('a.' + x) as never)`) sind ausgenommen —
    // die lassen sich hier nicht auflösen.
    const gefehlt = [...benutzt].filter((schluessel) => !(schluessel in de)).sort()
    expect(gefehlt, `von der Oberfläche benutzt, aber nicht im Wörterbuch: ${gefehlt.join(', ')}`).toEqual([])
    expect(benutzt.size).toBeGreaterThan(60)
  })

  it('definiert kein Wort zweimal', () => {
    // Im Object ist eine Doppelung unsichtbar — die zweite Zeile gewinnt still,
    // die erste ist einfach weg. Gesehen wird deshalb in die Datei selbst.
    const text = readFileSync('src/renderer/src/i18n/index.ts', 'utf8')
    const doppelte = (block: 'de' | 'en'): string[] => {
      const anfang = text.indexOf(`\n  ${block}: {`)
      const andern = (['de', 'en'] as const).filter((b) => b !== block).map((b) => text.indexOf(`\n  ${b}: {`))
      const ende = andern.filter((n) => n > anfang).sort((a, b) => a - b)[0] ?? text.length
      const namen = [...text.slice(anfang, ende).matchAll(/^\s{4}'([^']+)':/gm)].map((t) => t[1] as string)
      const gesehen = new Set<string>()
      return [...new Set(namen.filter((n) => (gesehen.has(n) ? true : (gesehen.add(n), false))))]
    }
    expect(doppelte('de'), 'in Deutsch doppelt').toEqual([])
    expect(doppelte('en'), 'in Englisch doppelt').toEqual([])
  })

  it('läßt keine leere Übersetzung stehen', () => {
    const leer = Object.entries(de).filter(([, wert]) => typeof wert === 'string' && wert.trim() === '').map(([k]) => k)
    expect(leer, `leer in Deutsch: ${leer.join(', ')}`).toEqual([])
    const leerEnglisch = Object.entries(en).filter(([, wert]) => typeof wert === 'string' && wert.trim() === '').map(([k]) => k)
    expect(leerEnglisch, `leer in Englisch: ${leerEnglisch.join(', ')}`).toEqual([])
  })

  it('übersetzt keinen Schlüssel ins Deutsche, wo Englisch stehen soll', () => {
    // Ein verräterisches Zeichen: deutsche Werte im englischen Wörterbuch.
    const verraeterisch = Object.entries(en).filter(([, wert]) => /\b(und|ist|nicht|für|mit|die|das|von|zu|auf)\b/.test(String(wert)))
    expect(verraeterisch.map(([schluessel]) => schluessel), `englische Schlüssel mit deutschem Text: ${verraeterisch.map(([s]) => s).join(', ')}`).toEqual([])
  })
})
