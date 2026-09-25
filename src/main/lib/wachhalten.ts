/**
 * Rechner wachhalten.
 *
 * Der Schalter allein war bisher nur ein Wunsch in der Einrichtung. Hier wird
 * daraus eine echte Meldung an das Betriebssystem: solange eine Antwort läuft,
 * bittet Hestia darum, nicht suspendiert zu werden.
 *
 * Zwei Dinge sind absichtlich so und nicht anders:
 *
 * - **Nur während einer Antwort.** Angewählt heißt nicht wachhalten. Ein Lauf,
 *   der um drei Uhr nachts fertig ist, soll den Rechner nicht bis morgens
 *   wachhalten. Deshalb zählt dieses Modul die laufenden Anfragen und gibt die
 *   Sperge frei, sobald die letzte geendet hat — auch bei Fehler oder Abbruch.
 * - **`prevent-app-suspension`, nicht `prevent-display-sleep`.** Ein laufendes
 *   Modell braucht den Bildschirm nicht, es braucht den Rechner. Der Bildschirm
 *   darf dunkel bleiben; der Strom soll nicht weggenommen werden.
 */
import { powerSaveBlocker } from 'electron'

let hemmer: number | null = null
let gewuenscht = false
let laufend = 0

function anwenden(): void {
  const soll = gewuenscht && laufend > 0
  if (soll && hemmer === null) {
    hemmer = powerSaveBlocker.start('prevent-app-suspension')
    return
  }
  if (!soll && hemmer !== null) {
    if (powerSaveBlocker.isStarted(hemmer)) powerSaveBlocker.stop(hemmer)
    hemmer = null
  }
}

/** Der Schalter aus der Einrichtung. */
export function wachhaltenSetzen(an: boolean): void {
  gewuenscht = an
  anwenden()
}

/** Eine Anfrage beginnt. */
export function anfrageBeginnt(): void {
  laufend += 1
  anwenden()
}

/** Eine Anfrage endet — egal wie. */
export function anfrageEndet(): void {
  laufend = Math.max(0, laufend - 1)
  anwenden()
}

export interface WachhaltenStatus {
  /** Der Schalter in der Einrichtung. */
  gewuenscht: boolean
  /** Wie viele Anfragen gerade laufen. */
  laufend: number
  /** Ob das Betriebssystem tatsächlich angefragt hat, nicht zu schlafen. */
  wach: boolean
}

export function wachhaltenStatus(): WachhaltenStatus {
  return {
    gewuenscht: gewuenscht,
    laufend,
    wach: hemmer !== null && powerSaveBlocker.isStarted(hemmer)
  }
}
