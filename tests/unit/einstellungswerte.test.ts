/**
 * Die Werte, welche die Oberfläche anbietet, müssen der Einrichtung passen.
 *
 * Ein `<select>`, das `last` sendet, während die Einrichtung `lastChat` will,
 * wirft beim Speichern — und weil niemand die Ablehnung zeigt, wirkt der
 * Knopf kaputt. Deshalb wird das hier an der echten Liste gehalten.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { settingsSchema } from '../../src/main/ipc'

const OBERFLAECHENTEXT = readFileSync('src/renderer/src/features/settings/SettingsModal.tsx', 'utf8')

describe('die offereden Werte', () => {
  it('nehmen bei der Startansicht beide Vorgaben der Einrichtung', () => {
    expect(() => settingsSchema.parse({ startView: 'home' })).not.toThrow()
    expect(() => settingsSchema.parse({ startView: 'lastChat' })).not.toThrow()
    // Der alte Wert: sah plausibel aus und ging nie durch.
    expect(() => settingsSchema.parse({ startView: 'last' })).toThrow()
  })

  it('bieten bei jeder Auswahl nur Werte an, die die Einrichtung kennt', () => {
    // Für jede Auswahlzeile in der Oberfläche: die angebotenen Werte müssen in
    // der Aufzählung der Einrichtung stehen. Das ist die Klasse des Fehlers,
    // den niemand sieht — der Knopf speichert nur nie.
    const felder: Array<[string, string]> = [
      ['settings.startView', 'startView'],
      ['settings.design', 'theme'],
      ['settings.language', 'language']
    ]
    for (const [schluessel, feld] of felder) {
      const stelle = OBERFLAECHENTEXT.indexOf(`t('${schluessel}')`)
      expect(stelle, `die Oberfläche hat keine Zeile für ${schluessel}`).toBeGreaterThan(-1)
      const abschnitt = OBERFLAECHENTEXT.slice(stelle, stelle + 700)
      const anbieter = [...abschnitt.matchAll(/\['([a-zA-Z]+)',/g)].map((treffer) => treffer[1] as string)
      expect(anbieter.length, `für ${feld} wurden keine Werte gefunden`).toBeGreaterThan(0)
      // Die Felder sind optional, die Aufzählung sitzt eine Schicht tiefer.
      const regel = settingsSchema.shape[feld as 'startView'] as unknown as {
        options?: string[]
        unwrap?: () => { options: string[] }
      }
      const erlaubt = regel.options ?? regel.unwrap?.().options ?? []
      expect(erlaubt.length, `${feld} hat keine Aufzählung`).toBeGreaterThan(0)
      for (const wert of anbieter) {
        expect(erlaubt, `die Oberfläche bietet „${wert}" an, ${feld} kennt es nicht`).toContain(wert)
      }
    }
  })

  it('lassen die andern Felder in Ruhe, wenn nur eines gesendet wird', () => {
    const einzeln = settingsSchema.parse({ startView: 'lastChat' })
    expect(einzeln).toEqual({ startView: 'lastChat' })
  })
})
