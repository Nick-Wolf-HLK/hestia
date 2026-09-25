/**
 * Ob der Schalter wirklich etwas tut.
 *
 * Die Klappe ist billig zu bauen, der Fehler sitzt im Ablauf: zweimal anfangen,
 * einmal enden; enden ohne Anfang; Fehler mitten im Lauf. Deshalb wird hier
 * nichts behauptet, sondern jede Folge durchgespielt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const starts = vi.fn()
const stops = vi.fn()
let laufend = new Set<number>()
let naechste = 0
vi.mock('electron', () => ({
  powerSaveBlocker: {
    start: () => {
      const id = naechste++
      laufend.add(id)
      starts(id)
      return id
    },
    stop: (id: number) => {
      laufend.delete(id)
      stops(id)
    },
    isStarted: (id: number) => laufend.has(id)
  }
}))

const { anfrageBeginnt, anfrageEndet, wachhaltenSetzen, wachhaltenStatus } = await import('../../src/main/lib/wachhalten')

beforeEach(() => {
  starts.mockClear()
  stops.mockClear()
  laufend = new Set()
  naechste = 0
  anfrageEndet()
  anfrageEndet()
  wachhaltenSetzen(false)
})

describe('Rechner wachhalten', () => {
  it('hält nichts wach, ohne dass der Schalter an ist', () => {
    wachhaltenSetzen(false)
    anfrageBeginnt()
    expect(starts).not.toHaveBeenCalled()
    expect(wachhaltenStatus().wach).toBe(false)
    anfrageEndet()
  })

  it('hält nichts wach, wenn der Schalter an ist aber nichts läuft', () => {
    wachhaltenSetzen(true)
    expect(starts).not.toHaveBeenCalled()
    expect(wachhaltenStatus()).toEqual({ gewuenscht: true, laufend: 0, wach: false })
  })

  it('hält während einer Antwort wach und gibt wieder frei', () => {
    wachhaltenSetzen(true)
    anfrageBeginnt()
    expect(starts).toHaveBeenCalledTimes(1)
    expect(wachhaltenStatus().wach).toBe(true)
    anfrageEndet()
    expect(stops).toHaveBeenCalledTimes(1)
    expect(wachhaltenStatus().wach).toBe(false)
  })

  it('hält bei zwei Anfragen einmal wach und gibt erst nach der letzten frei', () => {
    wachhaltenSetzen(true)
    anfrageBeginnt()
    anfrageBeginnt()
    expect(starts).toHaveBeenCalledTimes(1)
    anfrageEndet()
    expect(stops).not.toHaveBeenCalled()
    expect(wachhaltenStatus().wach).toBe(true)
    anfrageEndet()
    expect(stops).toHaveBeenCalledTimes(1)
    expect(wachhaltenStatus().wach).toBe(false)
  })

  it('endet nicht unter null, wenn eine Anfrage ohne Anfang endet', () => {
    wachhaltenSetzen(true)
    anfrageEndet()
    anfrageEndet()
    expect(wachhaltenStatus().laufend).toBe(0)
    expect(stops).not.toHaveBeenCalled()
    anfrageBeginnt()
    expect(wachhaltenStatus().wach).toBe(true)
    anfrageEndet()
    expect(wachhaltenStatus().wach).toBe(false)
  })

  it('gibt sofort frei, wenn der Schalter mitten im Lauf ausgeht', () => {
    wachhaltenSetzen(true)
    anfrageBeginnt()
    expect(wachhaltenStatus().wach).toBe(true)
    wachhaltenSetzen(false)
    expect(stops).toHaveBeenCalledTimes(1)
    expect(wachhaltenStatus().wach).toBe(false)
    // Und beim Wiedereinschalten läuft es weiter, ohne neu zu zählen.
    wachhaltenSetzen(true)
    expect(starts).toHaveBeenCalledTimes(2)
    anfrageEndet()
    expect(wachhaltenStatus().wach).toBe(false)
  })

  it('meldet den Stand ehrlich', () => {
    wachhaltenSetzen(true)
    anfrageBeginnt()
    anfrageBeginnt()
    expect(wachhaltenStatus()).toEqual({ gewuenscht: true, laufend: 2, wach: true })
  })
})
