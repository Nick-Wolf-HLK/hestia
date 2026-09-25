/**
 * Gedächtnis und Projekt-Kontext: getrennte Speicher, die Werkzeuge des
 * Modells, der Suchindex und das Lesen der Dateien.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import { abschnitte, ftsAnfrage, Store } from '../../src/main/db'
import { gedaechtnisTeile, kurzId, mitGedaechtnis } from '../../src/main/gedaechtnis'
import { textAusDatei, VOLLSTAENDIG_BIS } from '../../src/main/kontext'
import { DEFAULT_SETTINGS, type Chat, type Settings } from '@shared/types'

let dir = ''
let store: Store

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hestia-gedaechtnis-'))
  store = new Store(join(dir, 'test.db'))
})

afterEach(async () => {
  store.close()
  await rm(dir, { recursive: true, force: true })
})

const einstellungen = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch })

function chatIn(projectId?: string): Chat {
  return store.createChat({ mode: 'chat', projectId })
}

describe('Gedächtnis-Speicher', () => {
  it('hält den allgemeinen Speicher und die Projekt-Speicher getrennt', () => {
    const projekt = store.createProject({ name: 'Bewerbung' })
    store.addErinnerung({ thema: 'Person', text: 'Heißt Alex' })
    store.addErinnerung({ projectId: projekt.id, thema: 'Ziel', text: 'Sucht eine Stelle als KI-Engineer' })

    expect(store.listErinnerungen().map((e) => e.text)).toEqual(['Heißt Alex'])
    expect(store.listErinnerungen(projekt.id).map((e) => e.text)).toEqual(['Sucht eine Stelle als KI-Engineer'])
  })

  it('ändert, löscht und leert Einträge', () => {
    const eintrag = store.addErinnerung({ thema: 'Vorlieben', text: 'Mag kurze Antworten' })
    store.updateErinnerung(eintrag.id, { text: 'Mag sehr kurze Antworten' })
    expect(store.getErinnerung(eintrag.id)?.text).toBe('Mag sehr kurze Antworten')
    store.deleteErinnerung(eintrag.id)
    expect(store.listErinnerungen()).toHaveLength(0)

    store.addErinnerung({ thema: 'A', text: 'eins' })
    store.addErinnerung({ thema: 'B', text: 'zwei' })
    store.clearErinnerungen()
    expect(store.listErinnerungen()).toHaveLength(0)
  })

  it('nimmt beim Löschen eines Projekts dessen Gedächtnis und Dateien mit', () => {
    const projekt = store.createProject({ name: 'Weg damit' })
    store.addErinnerung({ projectId: projekt.id, thema: 'X', text: 'y' })
    store.addProjektDatei({ projectId: projekt.id, name: 'a.md', art: 'MD', groesse: 3, text: 'Inhalt' })
    store.deleteProject(projekt.id)
    expect(store.listErinnerungen(projekt.id)).toHaveLength(0)
    expect(store.listProjektDateien(projekt.id)).toHaveLength(0)
    expect(store.sucheImProjekt(projekt.id, 'Inhalt')).toHaveLength(0)
  })
})

describe('Suchindex', () => {
  it('findet Abschnitte über Stichwörter — auch ohne Umlaute getippt', () => {
    const projekt = store.createProject({ name: 'Bewerbung' })
    store.addProjektDatei({
      projectId: projekt.id,
      name: 'Lebenslauf.pdf',
      art: 'PDF',
      groesse: 100,
      text: 'Berufserfahrung: 2019 bis 2024 Projektleitung bei der Müller GmbH. Ausbildung zum Fachinformatiker.'
    })
    store.addProjektDatei({ projectId: projekt.id, name: 'Hobbys.md', art: 'MD', groesse: 10, text: 'Wandern und Kochen.' })

    const treffer = store.sucheImProjekt(projekt.id, 'mueller projektleitung')
    expect(treffer[0]?.datei).toBe('Lebenslauf.pdf')
    expect(store.sucheImProjekt(projekt.id, 'muller')[0]?.datei).toBe('Lebenslauf.pdf')
    expect(store.sucheImProjekt(projekt.id, 'Quantenphysik')).toHaveLength(0)
  })

  it('verträgt Anfragen mit Sonderzeichen und Operatorwörtern', () => {
    expect(ftsAnfrage('C++ AND "Rust" NOT (Go)')).toBe('"c" OR "and" OR "rust" OR "not" OR "go"'.replace('"c" OR ', ''))
    expect(ftsAnfrage('!!!')).toBe('')
    const projekt = store.createProject({ name: 'P' })
    store.addProjektDatei({ projectId: projekt.id, name: 'x.txt', art: 'TXT', groesse: 1, text: 'Rust und Go' })
    expect(() => store.sucheImProjekt(projekt.id, 'Rust AND "Go" NOT (x')).not.toThrow()
  })

  it('zerlegt lange Texte in überlappende Abschnitte ohne etwas zu verlieren', () => {
    const text = Array.from({ length: 60 }, (_, i) => `Satz Nummer ${i} über das Thema.`).join(' ')
    const teile = abschnitte(text)
    expect(teile.length).toBeGreaterThan(1)
    for (let i = 0; i < 60; i++) expect(teile.some((t) => t.includes(`Nummer ${i} `))).toBe(true)
  })

  it('liest eine Datei auch über einen Teil ihres Namens und ab einer Stelle', () => {
    const projekt = store.createProject({ name: 'P' })
    store.addProjektDatei({ projectId: projekt.id, name: 'Portfolio 2026.pdf', art: 'PDF', groesse: 1, text: 'abcdefghij' })
    expect(store.projektDateiText(projekt.id, 'portfolio', 3, 4)).toEqual({ name: 'Portfolio 2026.pdf', text: 'defg', gesamt: 10 })
    expect(store.projektDateiText(projekt.id, 'gibtsnicht')).toBeUndefined()
  })
})

describe('Werkzeuge des Modells', () => {
  it('merkt sich im Projekt-Speicher des Chats und meldet die Änderung', async () => {
    const projekt = store.createProject({ name: 'Bewerbung' })
    const chat = chatIn(projekt.id)
    const gemeldet: (string | undefined)[] = []
    const kasten = mitGedaechtnis(undefined, { store, chat, settings: einstellungen(), geaendert: (id) => gemeldet.push(id) })!

    const ergebnis = await kasten.execute('1', 'erinnerung_merken', { thema: 'Ziel', text: 'Sucht Homeoffice ab 90 000 Euro' })
    expect(ergebnis.ok).toBe(true)
    expect(store.listErinnerungen(projekt.id)[0]?.text).toBe('Sucht Homeoffice ab 90 000 Euro')
    expect(store.listErinnerungen()).toHaveLength(0)
    expect(gemeldet).toEqual([projekt.id])

    const doppelt = await kasten.execute('2', 'erinnerung_merken', { thema: 'Ziel', text: 'sucht homeoffice ab 90 000 euro' })
    expect(doppelt.output).toMatch(/Steht schon/)
    expect(store.listErinnerungen(projekt.id)).toHaveLength(1)
  })

  it('ändert und löscht über die Kurzkennung — aber nie in einem fremden Speicher', async () => {
    const projekt = store.createProject({ name: 'P' })
    const fremd = store.addErinnerung({ thema: 'Allgemein', text: 'gehört nicht zum Projekt' })
    const eigen = store.addErinnerung({ projectId: projekt.id, thema: 'T', text: 'alt' })
    const kasten = mitGedaechtnis(undefined, { store, chat: chatIn(projekt.id), settings: einstellungen() })!

    await kasten.execute('1', 'erinnerung_aendern', { kennung: `[${kurzId(eigen.id)}]`, text: 'neu' })
    expect(store.getErinnerung(eigen.id)?.text).toBe('neu')

    const versuch = await kasten.execute('2', 'erinnerung_loeschen', { kennung: kurzId(fremd.id) })
    expect(versuch.ok).toBe(false)
    expect(store.getErinnerung(fremd.id)).toBeDefined()

    await kasten.execute('3', 'erinnerung_loeschen', { kennung: kurzId(eigen.id) })
    expect(store.getErinnerung(eigen.id)).toBeUndefined()
  })

  it('sucht und liest im Projekt, und reicht fremde Werkzeuge an den inneren Kasten weiter', async () => {
    const projekt = store.createProject({ name: 'P' })
    store.addProjektDatei({ projectId: projekt.id, name: 'Vita.md', art: 'MD', groesse: 1, text: 'Studium der Informatik in Köln.' })
    const innen = { specs: [{ name: 'create_document', description: '', parameters: {} }], execute: async () => ({ ok: true, output: 'innen' }) }
    const kasten = mitGedaechtnis(innen, { store, chat: chatIn(projekt.id), settings: einstellungen() })!

    expect(kasten.specs.map((s) => s.name)).toEqual([
      'create_document', 'erinnerung_merken', 'erinnerung_aendern', 'erinnerung_loeschen', 'projekt_durchsuchen', 'projekt_datei_lesen'
    ])
    expect((await kasten.execute('1', 'projekt_durchsuchen', { anfrage: 'Studium Koeln' })).output).toMatch(/Vita\.md/)
    expect((await kasten.execute('2', 'projekt_datei_lesen', { datei: 'vita' })).output).toMatch(/Informatik/)
    expect((await kasten.execute('3', 'create_document', {})).output).toBe('innen')
  })

  it('lässt den Kasten unverändert, wenn das Gedächtnis aus ist und keine Dateien da sind', () => {
    const innen = { specs: [], execute: async () => ({ ok: true, output: '' }) }
    expect(mitGedaechtnis(innen, { store, chat: chatIn(), settings: einstellungen({ gedaechtnisAn: false }) })).toBe(innen)
  })
})

describe('Systemprompt', () => {
  it('zeigt die Einträge mit Kennung und hält sensible Themen draußen, solange der Schalter aus ist', () => {
    const eintrag = store.addErinnerung({ thema: 'Beruf', text: 'Arbeitet als Berater' })
    const [teil] = gedaechtnisTeile(store, chatIn(), einstellungen(), true)
    expect(teil).toContain(`[${kurzId(eintrag.id)}] Beruf: Arbeitet als Berater`)
    expect(teil).toMatch(/Gesundheit, Religion/)
    const [offen] = gedaechtnisTeile(store, chatIn(), einstellungen({ gedaechtnisSensibel: true }), true)
    expect(offen).not.toMatch(/Gesundheit, Religion/)
  })

  it('gibt kleines Projektwissen komplett mit und schaltet bei viel Text in den Suchmodus', () => {
    const projekt = store.createProject({ name: 'Bewerbung' })
    store.addProjektDatei({ projectId: projekt.id, name: 'Lebenslauf.md', art: 'MD', groesse: 1, text: 'Geboren 1975 in Musterstadt.' })
    const klein = gedaechtnisTeile(store, chatIn(projekt.id), einstellungen({ gedaechtnisAn: false }), true).join('\n')
    expect(klein).toContain('<datei name="Lebenslauf.md">')
    expect(klein).toContain('Geboren 1975 in Musterstadt.')

    store.addProjektDatei({ projectId: projekt.id, name: 'Portfolio.pdf', art: 'PDF', groesse: 1, text: 'x'.repeat(VOLLSTAENDIG_BIS) })
    const gross = gedaechtnisTeile(store, chatIn(projekt.id), einstellungen({ gedaechtnisAn: false }), true).join('\n')
    expect(gross).toMatch(/Suchmodus/)
    expect(gross).not.toContain('Geboren 1975')
    expect(gross).toContain('projekt_durchsuchen')
  })
})

describe('Dateien lesen', () => {
  it('liest Word-Dokumente (.docx)', async () => {
    const doc = new Document({
      sections: [{ children: [new Paragraph({ children: [new TextRun('Sehr geehrte Damen & Herren,')] }), new Paragraph('zweiter Absatz')] }]
    })
    const daten = await Packer.toBuffer(doc)
    const { art, text } = await textAusDatei('Anschreiben.docx', Buffer.from(daten))
    expect(art).toBe('DOCX')
    expect(text).toBe('Sehr geehrte Damen & Herren,\nzweiter Absatz')
  })

  it('liest PDFs', async () => {
    const { text } = await textAusDatei('mini.pdf', miniPdf('Hallo aus dem Lebenslauf'))
    expect(text).toContain('Hallo aus dem Lebenslauf')
  })

  it('liest HTML ohne Skripte und Textdateien mit Umlauten', async () => {
    const html = await textAusDatei('seite.html', Buffer.from('<p>Größe &amp; Maß</p><script>alert(1)</script><p>zwei</p>'))
    expect(html.text).toBe('Größe & Maß\nzwei')
    expect((await textAusDatei('notiz', Buffer.from('Übung macht den Meister'))).text).toBe('Übung macht den Meister')
  })

  it('lehnt Unlesbares mit einer verständlichen Meldung ab', async () => {
    await expect(textAusDatei('bild.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).rejects.toThrow(/nicht lesen/)
    await expect(textAusDatei('leer.txt', Buffer.from('   \n  '))).rejects.toThrow(/keinen lesbaren Text/)
  })
})

/** Ein winziges, gültiges PDF mit einer Textzeile. */
function miniPdf(zeile: string): Buffer {
  const inhalt = `BT /F1 12 Tf 20 100 Td (${zeile}) Tj ET`
  const objekte = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${inhalt.length} >>\nstream\n${inhalt}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let pdf = '%PDF-1.4\n'
  const stellen: number[] = []
  objekte.forEach((obj, i) => {
    stellen.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`
  for (const stelle of stellen) pdf += `${String(stelle).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}
