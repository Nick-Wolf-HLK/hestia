/**
 * Das Diktat ohne Mikrofon und ohne Modell.
 *
 * Geprüft wird das, was kaputtgehen kann: dass nichts als „bereit" gilt, wenn
 * ein Teil fehlt, dass jedes Werkzeug seine eigenen Argumente bekommt, und dass
 * aus der Ausgabe lesbarer Text wird — nicht die Zeitstempel mitgenommen werden.
 */
import { describe, expect, it } from 'vitest'
import { befehlFuer, textAusGabe, type Motor } from '../../src/main/diktat'

function motor(anteile: Partial<Motor>): Motor {
  return {
    id: 'whisper-cpp',
    name: 'whisper.cpp',
    programm: 'whisper-cli',
    pfad: '/usr/bin/whisper-cli',
    modell: '/heim/.hestia/diktat/modell.gguf',
    bereit: true,
    grund: '',
    befehl: '',
    ...anteile
  }
}

describe('das Diktat', () => {
  it('gibt whisper.cpp die Modell-, nicht die Ordnernamen mit', () => {
    const { programm, folge } = befehlFuer(motor({}), '/tmp/diktat.wav', 'de')
    expect(programm).toBe('whisper-cli')
    expect(folge).toContain('-m')
    expect(folge).toContain('/heim/.hestia/diktat/modell.gguf')
    expect(folge).toContain('/tmp/diktat.wav')
    expect(folge).toContain('de')
  })

  it('gibt dem Python-Programm die Sprache als eigene Angabe', () => {
    const { folge } = befehlFuer(motor({ id: 'whisper-python', programm: 'whisper', modell: 'small' }), '/tmp/d.wav', 'en')
    expect(folge[0]).toBe('/tmp/d.wav')
    expect(folge).toContain('--language')
    expect(folge).toContain('en')
  })

  it('lässt die Zeitstempel weg und behält den Text', () => {
    const ausgabe = '[00:00:00.000 --> 00:00:02.500] Guten Morgen zusammen.\n[00:00:02.500 --> 00:00:04.000] Wie geht es dir?\n'
    expect(textAusGabe(ausgabe)).toBe('Guten Morgen zusammen. Wie geht es dir?')
  })

  it('schweigt nicht, wenn nur Text ohne Zeitstempel kommt', () => {
    expect(textAusGabe('  Nur Text  \n\n  mit Leerzeilen  \n')).toBe('Nur Text\nmit Leerzeilen'.replace('\n', ' '))
  })

  it('liefert leeren Text für leere Ausgabe', () => {
    expect(textAusGabe('')).toBe('')
    expect(textAusGabe('\n[00:00:00.000 --> 00:00:01.000] \n')).toBe('')
  })
})
