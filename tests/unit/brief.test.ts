import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { briefAlsQuelle, briefAus, briefAusQuelle, briefBloecke } from '../../src/main/documents/brief'

vi.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: () => ({ webRequest: { onBeforeRequest() {} } }) } }))
vi.mock('../../src/main/logger', () => ({ log: { info() {}, warn() {}, error() {} } }))

const felder = {
  absender: 'Erika Muster\nHauptstraße 1\n12345 Musterstadt',
  empfaenger: 'Beispiel GmbH\nPersonalabteilung\nWeg 2\n54321 Beispielort',
  ort_datum: 'Musterstadt, 1. Oktober 2026',
  betreff: 'Bewerbung als Beraterin',
  anrede: 'Sehr geehrte Frau Beispiel,',
  text: 'Erster Absatz.\n\n- Punkt eins\n- Punkt zwei\n\nZweiter Absatz.',
  name: 'Erika Muster',
  anlagen: ['Lebenslauf', 'Zeugnisse']
}

describe('briefAus', () => {
  it('liest die Felder aus `brief`', () => {
    const b = briefAus({ format: 'docx', brief: felder })!
    expect(b.absender).toEqual(['Erika Muster', 'Hauptstraße 1', '12345 Musterstadt'])
    expect(b.empfaenger).toHaveLength(4)
    expect(b.betreff).toBe('Bewerbung als Beraterin')
    expect(b.gruss).toBe('Mit freundlichen Grüßen')
    expect(b.anlagen).toEqual(['Lebenslauf', 'Zeugnisse'])
  })

  it('verzeiht andere Feldnamen, flache Angaben und JSON-Text', () => {
    const flach = briefAus({ format: 'pdf', empfänger: 'Firma X', subject: 'Betreff: Anfrage', inhalt: 'Hallo Welt.' })!
    expect(flach.empfaenger).toEqual(['Firma X'])
    expect(flach.betreff).toBe('Anfrage')
    expect(flach.text).toBe('Hallo Welt.')
    expect(flach.anrede).toBe('Sehr geehrte Damen und Herren,')
    expect(flach.ortDatum).toMatch(/\d{4}$/)
    expect(briefAus({ brief: JSON.stringify(felder) })?.betreff).toBe('Bewerbung als Beraterin')
    // So kam es von qwen3.5:9b: eine Klammer zu viel am Ende.
    expect(briefAus({ brief: `${JSON.stringify(felder)}}` })?.betreff).toBe('Bewerbung als Beraterin')
    expect(briefAus({ brief: `Hier der Brief: ${JSON.stringify({ ...felder, text: 'Mit {Klammer} und "Zitat"' })} fertig` })?.text).toBe('Mit {Klammer} und "Zitat"')
  })

  it('ist kein Brief ohne Brief-Felder', () => {
    expect(briefAus({ format: 'pdf', content: '# Bericht' })).toBeNull()
  })

  it('räumt auf, was das Modell doppelt in den Text schreibt', () => {
    const b = briefAus({
      brief: {
        ...felder,
        empfaenger: '# Beispiel GmbH\n## Personalabteilung\n---',
        text: 'Sehr geehrte Frau Beispiel,\n\nDer eigentliche Text.\n\n---\n\nMit freundlichen Grüßen\n\nErika Muster'
      }
    })!
    expect(b.empfaenger).toEqual(['Beispiel GmbH', 'Personalabteilung'])
    expect(b.text).toBe('Der eigentliche Text.')
  })
})

describe('Briefquelle', () => {
  it('übersteht Speichern und Neusetzen unverändert', () => {
    const b = briefAus({ brief: felder })!
    expect(briefAusQuelle(briefAlsQuelle(b))).toEqual(b)
    expect(briefAusQuelle('# Kein Brief')).toBeNull()
  })

  it('macht Überschriften im Text zu fetten Absätzen', () => {
    const bloecke = briefBloecke('## Zwischentitel\n\nText')
    expect(bloecke[0]).toMatchObject({ type: 'paragraph', inline: [{ text: 'Zwischentitel', bold: true }] })
  })
})

describe('Brief als Word-Datei', () => {
  it('setzt Betreff, Anrede, Text und Anlagen', async () => {
    const { createDocument } = await import('../../src/main/documents/create')
    const ordner = await mkdtemp(join(tmpdir(), 'hestia-brief-'))
    const pfad = join(ordner, 'brief.docx')
    await createDocument({ kind: 'docx', path: pfad, markdown: '', brief: briefAus({ brief: felder })! })
    const roh = await readFile(pfad)
    expect(roh.subarray(0, 2).toString()).toBe('PK')
    const xml = execFileSync('unzip', ['-p', pfad, 'word/document.xml']).toString('utf8')
    for (const teil of ['Bewerbung als Beraterin', 'Sehr geehrte Frau Beispiel,', 'Punkt eins', 'Anlagen', 'Lebenslauf']) expect(xml).toContain(teil)
  })
})
