/**
 * Prüfungen für die Zugriffsstufen. Hier geht es um die Frage, was ein Auftrag
 * ohne Rückfrage darf — und was auch mit oberster Stufe verboten bleibt.
 */
import { describe, expect, it } from 'vitest'
import { accessFor } from '../../src/main/agent/access'

describe('Zugriffsstufen', () => {
  it('fragt ohne Eintrag nach allem', () => {
    const limits = accessFor(undefined, { autoApproveWrites: false, allowCommands: true })

    expect(limits).toEqual({ autoApproveWrites: false, allowCommands: false })
  })

  it('lässt bei „manuell" nichts ungefragt laufen', () => {
    expect(accessFor('ask', { autoApproveWrites: false, allowCommands: true })).toEqual({
      autoApproveWrites: false,
      allowCommands: false
    })
  })

  it('schreibt bei „automatisch" im Ordner, fragt aber weiter nach Kommandos', () => {
    // Die globale Erlaubnis für Kommandos ist an, die Stufe erlaubt sie nicht.
    expect(accessFor('autoWrites', { autoApproveWrites: false, allowCommands: true })).toEqual({
      autoApproveWrites: true,
      allowCommands: false
    })
  })

  it('gibt bei „überspringen" beides frei, wenn die Grundeinstellung mitspielt', () => {
    // Nur die oberste Stufe befreit auch ein Kommando von der Rückfrage.
    expect(accessFor('everything', { autoApproveWrites: false, allowCommands: true })).toEqual({
      autoApproveWrites: true,
      allowCommands: true
    })
  })

  it('hält Kommandos auch auf der mittleren Stufe zur Rückfrage an', () => {
    expect(accessFor('autoWrites', { autoApproveWrites: false, allowCommands: true }).allowCommands).toBe(false)
  })

  it('lässt sich verbotene Kommandos nicht freischalten', () => {
    // Die Grundeinstellung ist die Obergrenze: die höchste Stufe eines
    // einzelnen Auftrags kann ein globales Verbot nicht kippen.
    expect(accessFor('everything', { autoApproveWrites: false, allowCommands: false }).allowCommands).toBe(false)
  })

  it('übernimmt eine global gesetzte Schreib-Erlaubnis in jede Stufe', () => {
    expect(accessFor('ask', { autoApproveWrites: true, allowCommands: false }).autoApproveWrites).toBe(true)
  })
})
