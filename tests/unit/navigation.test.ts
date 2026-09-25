/**
 * Führt die Navigation irgendwo hin?
 *
 * Ein Eintrag in der Seitenleiste und ein Zweig in der Hauptseite sind zwei
 * getrennte Listen. Wer eine Ansicht hinzufügt und die andere vergißt, bekommt
 * einen Knopf, der **nichts** zeigt — weiße Fläche, kein Fehler, keine Meldung.
 *
 * Die Prüfung hält beide Listen gegeneinander und schreibt die bewußten
 * Ausnahmen ausdrücklich hin: eine Ausrede, die unterzeichnet ist, fällt auf,
 * eine unbemerkte nicht.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const HAUPTSEITE = readFileSync('src/renderer/src/App.tsx', 'utf8')
const LEISTE = readFileSync('src/renderer/src/components/Sidebar.tsx', 'utf8')
const NAMEN = readFileSync('src/renderer/src/lib/store.ts', 'utf8')

/** Ansichten ohne eigenen Inhalt — bewußt, vorläufig, mit Namen. */
/** Ansichten ohne eigenen Inhalt — aktuell keine. Kommt eine dazu, muß sie
 * hier genannt werden, sonst fällt die Prüfung auf. */
const BAUSTELLEN = new Set<string>([])

/** Die Namen der Ansicht, wie der Speicher sie kennt (aus der Typvereinbarung). */
function ansichtsNamen(): string[] {
  const stelle = NAMEN.indexOf('export type ViewName =')
  const abschnitt = NAMEN.slice(stelle, NAMEN.indexOf('export ', stelle + 10))
  return [...abschnitt.matchAll(/\|\s*'([a-zA-Z]+)'/g)].map((treffer) => treffer[1] as string)
}

describe('die Navigation', () => {
  it('hat für jeden Ansichtsnamen einen Zweig in der Hauptseite', () => {
    const namen = ansichtsNamen()
    expect(namen.length).toBeGreaterThan(5)
    for (const name of namen) {
      expect(HAUPTSEITE, `„${name}" ist eine Ansicht, aber die Hauptseite kennt keinen Zweig dafür`).toContain(`view === '${name}'`)
    }
  })

  it('bietet in der Seitenleiste nur Ansichten an, die es gibt', () => {
    const geboten = [...LEISTE.matchAll(/view: '([a-zA-Z]+)'/g)].map((treffer) => treffer[1] as string)
    expect(gebote(geboten).length).toBeGreaterThan(3)
    const bekannte = new Set(ansichtsNamen())
    for (const name of gebote(geboten)) {
      expect(bekannte.has(name), `die Seitenleiste bietet „${name}" an, die Ansicht existiert nicht`).toBe(true)
    }
  })

  it('zeigt, was sie als Baustelle markiert — und nicht mehr', () => {
    const hohl = [...HAUPTSEITE.matchAll(/view === '([a-zA-Z]+)' && <Placeholder/g)].map((treffer) => treffer[1] as string)
    expect(new Set(hohl)).toEqual(BAUSTELLEN)
  })
})

function gebote(namen: string[]): string[] {
  return [...new Set(namen)]
}
