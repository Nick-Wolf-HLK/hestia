/**
 * Die Breite beim Ziehen — die Rechnung, nicht das Ereignis.
 *
 * Der Fehler war eine gemischte Größe: Bildschirmwert und Breite. Deshalb wird
 * hier die Rechnung selbst geprüft: beim Anpacken darf nichts springen, und der
 * Weg muss eins zu eins ankommen.
 */
import { describe, expect, it } from 'vitest'
import { breiteAusZeiger } from '../../src/renderer/src/features/chat/DocumentPanel'

describe('die Panelbreite beim Ziehen', () => {
  it('springt nicht, wenn der Zeiger gerade angefasst wurde', () => {
    expect(breiteAusZeiger(513, 727, 727)).toBe(513)
  })

  it('wird breiter, wenn der Zeiger nach links wandert', () => {
    expect(breiteAusZeiger(513, 727, 687)).toBe(553)
    expect(breiteAusZeiger(513, 727, 587)).toBe(653)
  })

  it('wird schmaler, wenn der Zeiger nach rechts wandert', () => {
    expect(breiteAusZeiger(513, 727, 767)).toBe(473)
  })

  it('kommt jeder Schritt einzeln genauso an wie am Stück', () => {
    let breite = 513
    let zeiger = 727
    for (let schritt = 0; schritt < 7; schritt++) {
      zeiger -= 20
      breite = breiteAusZeiger(breite, zeiger + 20, zeiger)
    }
    expect(breite).toBe(513 + 140)
  })
})
