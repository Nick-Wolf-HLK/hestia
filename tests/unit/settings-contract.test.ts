/**
 * Vertrag zwischen Oberfläche und Einstellungsscheibe.
 *
 * Die Scheibe prüft eingehende Änderungen mit einer Liste bekannter Felder und
 * wirft unbekannte still weg. Fehlt ein Feld dort, das die Oberfläche schreibt,
 * merkt sich die App Wert nicht — ohne Fehlermeldung. Diese Prüfung vergleicht
 * die Felder der Schnittstelle mit denen der Liste.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../..')
const types = readFileSync(path.join(root, 'src/shared/types.ts'), 'utf8')
const ipc = readFileSync(path.join(root, 'src/main/ipc.ts'), 'utf8')

/** Feldnamen einer TypeScript-Schnittstelle, robut aus dem Quelltext gelesen. */
function fields(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name} {`)
  if (start < 0) throw new Error(`Schnittstelle ${name} nicht gefunden`)
  const body = source.slice(start, source.indexOf('\n}', start))
  return [...body.matchAll(/^ {2}([a-zA-Z]+)\??:/gm)].map((match) => match[1]!)
}

/** Feldnamen einer zod-Scheibe. */
function schemaFields(source: string, name: string): string[] {
  const start = source.indexOf(`const ${name} = z.object({`)
  if (start < 0) throw new Error(`Scheibe ${name} nicht gefunden`)
  const body = source.slice(start, source.indexOf('\n})', start))
  return [...body.matchAll(/^ {2}([a-zA-Z]+):/gm)].map((match) => match[1]!)
}

describe('Einstellungsvertrag', () => {
  const einstellungen = fields(types, 'Settings')
  const scheibe = schemaFields(ipc, 'settingsSchema')

  it('kennt die Schnittstelle und die Scheibe überhaupt', () => {
    expect(einstellungen.length).toBeGreaterThan(6)
    expect(scheibe.length).toBeGreaterThan(6)
  })

  it('lässt kein Feld der Oberfläche durch die Scheibe fallen', () => {
    const fehlend = einstellungen.filter((feld) => !scheibe.includes(feld))
    expect(fehlend, `in der Scheibe unbekannt: ${fehlend.join(', ')}`).toEqual([])
  })

  it('erfindet keine Felder, die es gar nicht gibt', () => {
    const zuviel = scheibe.filter((feld) => !einstellungen.includes(feld))
    expect(zuviel, `unbekanntes Feld in der Scheibe: ${zuviel.join(', ')}`).toEqual([])
  })
})
