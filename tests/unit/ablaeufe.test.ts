/**
 * Greifen die Schritte ineinander?
 *
 * Drei Stellen, an denen eine Funktion vorhanden, aber nicht erreichbar sein
 * kann — und der Benutzer nur einen Knopf sieht, der nichts tut:
 *
 * 1. Ein Werkzeug, das dem Modell **versprochen** wird, aber keine Ausführung
 *    hat: das Modell ruft es, nichts passiert, die Antwort stockt.
 * 2. Eine Methode, die die Oberfläche aufruft (`window.desk.…`), aber in der
 *    Brücke fehlt: ein Klick ins Leere, oft ohne Fehlermeldung.
 * 3. Eine Methode im Vertrag, die die Brücke nicht durchreicht.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function quellen(verzeichnis: string, out: string[] = []): string[] {
  for (const eintrag of readdirSync(verzeichnis)) {
    if (eintrag === 'node_modules' || eintrag.startsWith('.')) continue
    const pfad = join(verzeichnis, eintrag)
    if (statSync(pfad).isDirectory()) quellen(pfad, out)
    else if (/\.tsx?$/.test(pfad)) out.push(pfad)
  }
  return out
}

describe('das Ineinandergreifen', () => {
  it('hat jedes versprochene Werkzeug auch eine Ausführung', () => {
    const text = readFileSync('src/main/agent/tools.ts', 'utf8')
    // Versprochen wird in den Werkzeugbeschreibungen (`name: '…'`), ausgeführt
    // in einer Verzweigung über denselben Namen.
    const versprochen = [...text.matchAll(/^\s+name: '([a-z_]+)'/gm)].map((treffer) => treffer[1] as string)
    expect(versprochen.length).toBeGreaterThan(6)
    const ausgefuehrt = new Set([...text.matchAll(/case\s+'([a-z_]+)'/g)].map((treffer) => treffer[1] as string))
    const fehlend = versprochen.filter((name) => !ausgefuehrt.has(name))
    expect(fehlend, `dem Modell angeboten, aber ohne Ausführung: ${fehlend.join(', ')}`).toEqual([])
  })

  it('kennt jede Ausführung auch ein Werkzeug, das sie aufruft', () => {
    const text = readFileSync('src/main/agent/tools.ts', 'utf8')
    const versprochen = new Set([...text.matchAll(/^\s+name: '([a-z_]+)'/gm)].map((treffer) => treffer[1] as string))
    const ausgefuehrt = [...text.matchAll(/case\s+'([a-z_]+)'/g)].map((treffer) => treffer[1] as string)
    const verwaist = ausgefuehrt.filter((name) => !versprochen.has(name))
    expect(verwaist, `ausführbar, aber dem Modell nie angeboten: ${verwaist.join(', ')}`).toEqual([])
  })

  it('reicht die Brücke jede Methode durch, die der Vertrag verspricht', () => {
    const vertrag = readFileSync('src/shared/ipc.ts', 'utf8')
    const bruecke = readFileSync('src/shared/desk-api.ts', 'utf8')
    // Die Vertragstypen stehen in `DeskApi` als `name(...)` oder `name:`.
    const bereiche = [...vertrag.matchAll(/^ {2}([a-zA-Z]+): \{$/gm)].map((treffer) => treffer[1] as string)
    expect(bereiche.length).toBeGreaterThan(5)
    for (const bereich of bereiche) {
      expect(bruecke, `die Brücke hat keinen Bereich „${bereich}"`).toContain(`${bereich}:`)
    }
  })

  it('ruft die Oberfläche nur Methoden auf, die die Brücke auch bietet', () => {
    const bruecke = readFileSync('src/shared/desk-api.ts', 'utf8')
    const angebote = new Set<string>()
    // Bereiche und ihre Methoden aus der Brücke einsammeln.
    // Im Bauplan (shared/desk-api) stehen die Bereiche vier Stellen tief; wo
    // der Browser einen Ersatz hat, heißt es „anders.bereich ?? {“.
    for (const treffer of bruecke.matchAll(/^\s{4}([a-zA-Z]+): (?:anders\.[a-zA-Z]+ \?\? )?\{[\s\S]*?^\s{4}\},?$/gm)) {
      const bereich = treffer[1] as string
      for (const methode of treffer[0].matchAll(/^\s{6}([a-zA-Z]+)\s*[:(]/gm)) {
        angebote.add(`${bereich}.${methode[1]}`)
      }
    }
    expect(angebote.size).toBeGreaterThan(20)
    const benutzt = new Set<string>()
    for (const pfad of quellen('src/renderer/src')) {
      const text = readFileSync(pfad, 'utf8')
      for (const treffer of text.matchAll(/\bwindow\.desk\.([a-zA-Z]+)\.([a-zA-Z]+)\s*\(/g)) {
        benutzt.add(`${treffer[1]}.${treffer[2]}`)
      }
    }
    expect(benutzt.size).toBeGreaterThan(20)
    const fehlend = [...benutzt].filter((name) => !angebote.has(name)).sort()
    expect(fehlend, `die Oberfläche ruft Methoden auf, die die Brücke nicht bietet: ${fehlend.join(', ')}`).toEqual([])
  })

  it('hat jede Oberfläche auch die zugehörige Abonnementmöglichkeit', () => {
    const benannt = new Set<string>()
    for (const pfad of quellen('src/renderer/src')) {
      const text = readFileSync(pfad, 'utf8')
      for (const treffer of text.matchAll(/\bwindow\.desk\.on\.([a-zA-Z]+)\s*\(/g)) benannt.add(treffer[1] as string)
    }
    const bruecke = readFileSync('src/shared/desk-api.ts', 'utf8')
    for (const name of benannt) {
      expect(bruecke, `„on.${name}" wird benutzt, ist aber nicht gebaut`).toContain(`${name}:`)
    }
  })
})
