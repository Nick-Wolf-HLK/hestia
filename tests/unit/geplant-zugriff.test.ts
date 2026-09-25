/**
 * Was ein geplanter Lauf sich nehmen darf.
 *
 * Der Fehler, der hier festgehalten ist: die globale Freigabe „ohne Rückfrage
 * schreiben" galt auch für Aufträge, die **der Zeitplan** auslöst. Die stand-
 *hafte Entscheidung betrifft die Gespräche, die jemand selbst führt — nachts
 * ungefragt Dateien anzulegen ist etwas anderes. Ein geplanter Lauf erbt sie
 * deshalb nicht; er darf nur, wenn die Stufe **seines Gesprächs** es hergibt.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { accessFor } from '../../src/main/agent/access'

const LEITUNG = readFileSync('src/main/ipc.ts', 'utf8')
const STRENG = { autoApproveWrites: false, allowCommands: false }

describe('der geplante Lauf', () => {
  it('fragt, wenn sein Gespräch nichts anderes erlaubt', () => {
    expect(accessFor('ask', STRENG)).toEqual({ autoApproveWrites: false, allowCommands: false })
    expect(accessFor(undefined, STRENG).autoApproveWrites).toBe(false)
  })

  it('schreibt eher, wenn die Stufe des Gesprächs es ausdrücklich hergibt', () => {
    expect(accessFor('autoWrites', STRENG).autoApproveWrites).toBe(true)
  })

  it('läßt ein Kommandos nur in der obersten Stufe zu', () => {
    expect(accessFor('everything', STRENG).allowCommands).toBe(false)
    expect(accessFor('everything', { autoApproveWrites: false, allowCommands: true }).allowCommands).toBe(true)
  })

  it('erbt die globale Freigabe nicht', () => {
    // Der Beweis sitzt in der Leitung: der geplante Zweig rechnet mit der
    // strengen Grundlage, nicht mit den gespeicherten Einstellungen.
    expect(LEITUNG).toContain('accessFor(chat.permissionMode, { autoApproveWrites: false, allowCommands: false })')
    // Der geplante Lauf holt Werkzeuge und Skills gemeinsam — und reicht die
    // Strenge an den Werkzeugkasten weiter.
    expect(LEITUNG).toContain('laufMittel(chat, true)')
    // Werkzeugkasten und Dokumentrechte rechnen beide mit derselben Strenge.
    expect(LEITUNG).toContain('mitDokumenten(runtimeFor(chat, geplant), {')
    expect(LEITUNG).toContain('const zugriff = zugriffFuer(chat, geplant)')
    expect(LEITUNG).toContain('autoApproveWrites: zugriff.autoApproveWrites')
    expect(LEITUNG).toContain('mitSkills(mitDok, skills)')
  })
})
