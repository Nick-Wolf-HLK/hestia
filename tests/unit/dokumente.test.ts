/**
 * Weiterarbeiten an Dokumenten: gezielte Änderungen, Fassungen, Gestaltung.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), isPackaged: false }, BrowserWindow: class {} }))

const { Store } = await import('../../src/main/db')
const { mitDokumenten, dokumentTeile, wendeAn } = await import('../../src/main/dokumente')
const { parseMarkdown, renderHtmlDocument, gestaltungAufloesen } = await import('../../src/main/documents/markdown')
const { createDocumentRuntime } = await import('../../src/main/agent/tools')

let dir = ''
let store: InstanceType<typeof Store>

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hestia-dok-'))
  store = new Store(join(dir, 'test.db'))
})

afterEach(async () => {
  store.close()
  await rm(dir, { recursive: true, force: true })
})

describe('Gezielte Änderungen', () => {
  const quelle = '# Anschreiben\n\nSehr geehrte Damen und Herren,\n\nich bewerbe mich als Data Scientist.\n\nMit freundlichen Grüßen'

  it('ersetzt genau die genannte Stelle und lässt den Rest unangetastet', () => {
    const r = wendeAn(quelle, [{ alt: 'als Data Scientist', neu: 'als Senior Data Scientist' }])
    expect(r).toEqual({ text: quelle.replace('als Data Scientist', 'als Senior Data Scientist') })
  })

  it('verzeiht anderen Leerraum, lehnt aber Mehrdeutiges und Fehlendes ab', () => {
    expect('text' in wendeAn(quelle, [{ alt: 'Sehr geehrte\nDamen  und Herren,', neu: 'Hallo,' }])).toBe(true)
    expect(wendeAn('a b a b', [{ alt: 'a b', neu: 'x' }])).toMatchObject({ fehler: expect.stringMatching(/mehrfach/) })
    expect(wendeAn(quelle, [{ alt: 'gibt es nicht', neu: 'x' }])).toMatchObject({ fehler: expect.stringMatching(/steht nicht/) })
  })
})

describe('Dokumente im Chat', () => {
  function kasten(chatId: string) {
    const chat = store.getChat(chatId)!
    const innen = createDocumentRuntime({ chatId, settings: { autoApproveWrites: true, allowCommands: false }, permissions: { ask: async () => true } })
    return mitDokumenten(innen, { store, chat, folder: '', autoApproveWrites: true, permissions: { ask: async () => true } })!
  }

  it('merkt sich ein erzeugtes Dokument, ändert es gezielt und setzt es zurück', async () => {
    const chat = store.createChat({ mode: 'chat' })
    const k = kasten(chat.id)
    expect(k.specs.map((s) => s.name)).toEqual(['create_document', 'websuche', 'webseite_lesen', 'recherche', 'dokument_lesen', 'dokument_bearbeiten', 'dokument_wiederherstellen'])

    const pfad = join(dir, 'Einkauf.md')
    // Den Zielpfad selbst vorgeben, damit der Test nicht in die Dokumentablage schreibt.
    const erzeugt = await k.execute('1', 'create_document', { title: 'Einkauf', format: 'markdown', content: '# Einkauf\n\n- Milch\n- Brot' })
    expect(erzeugt.ok).toBe(true)
    const gemerkt = store.dokumenteFuer(chat.id)
    expect(gemerkt).toHaveLength(1)
    expect(gemerkt[0]!.markdown).toContain('- Brot')
    // Für den Rest des Tests auf eine Datei im Testordner umbiegen — und die
    // Datei aus der (umgebogenen) Dokumentablage wieder wegräumen.
    await rm(gemerkt[0]!.pfad, { force: true })
    store.aktualisiereDokument(gemerkt[0]!.id, { pfad })

    const lesen = await k.execute('2', 'dokument_lesen', { dokument: 'Einkauf.md' })
    expect(lesen.output).toContain('- Milch')

    const bearbeitet = await k.execute('3', 'dokument_bearbeiten', { dokument: 'Einkauf', aenderungen: [{ alt: '- Brot', neu: '- Vollkornbrot' }], anhaengen: '- Käse' })
    expect(bearbeitet.ok).toBe(true)
    expect(bearbeitet.document?.path).toBe(pfad)
    expect(await readFile(pfad, 'utf8')).toBe('# Einkauf\n\n- Milch\n- Vollkornbrot\n\n- Käse\n')

    const zurueck = await k.execute('4', 'dokument_wiederherstellen', { dokument: 'Einkauf' })
    expect(zurueck.ok).toBe(true)
    expect(await readFile(pfad, 'utf8')).toContain('- Brot')
    expect(store.dokumentNachPfad(pfad)!.version).toBe(4)
    await rm(join(tmpdir(), 'Hestia'), { recursive: true, force: true })
  })

  it('nennt die Dokumente im Systemprompt samt Regel, sie zu bearbeiten statt neu zu schreiben', () => {
    const chat = store.createChat({ mode: 'chat' })
    store.speichereDokument({ chatId: chat.id, pfad: '/x/Bewerbung.pdf', art: 'pdf', titel: 'Bewerbung', markdown: 'x', gestaltung: { vorlage: 'brief' } })
    const [teil] = dokumentTeile(store, chat, true)
    expect(teil).toContain('„Bewerbung“ → Datei Bewerbung.pdf (PDF, Fassung 1, Vorlage brief)')
    expect(teil).toContain('dokument_bearbeiten')
    expect(dokumentTeile(store, store.createChat({ mode: 'chat' }), true)).toEqual([])
  })

  it('findet im Agent-Ordner auch Dateien, die Hestia nicht selbst erzeugt hat', async () => {
    const ordner = join(dir, 'arbeit')
    await rm(ordner, { recursive: true, force: true })
    await (await import('node:fs/promises')).mkdir(ordner)
    await writeFile(join(ordner, 'notiz.md'), '# Notiz\n\nErste Zeile.\n')
    const chat = store.createChat({ mode: 'agent', folder: ordner })
    const innen = createDocumentRuntime({ chatId: chat.id, settings: { autoApproveWrites: true, allowCommands: false }, permissions: { ask: async () => true } })
    const k = mitDokumenten(innen, { store, chat, folder: ordner, autoApproveWrites: true, permissions: { ask: async () => true } })!
    const r = await k.execute('1', 'dokument_bearbeiten', { dokument: 'notiz.md', anhaengen: 'Zweite Zeile.' })
    expect(r.ok).toBe(true)
    expect(await readFile(join(ordner, 'notiz.md'), 'utf8')).toBe('# Notiz\n\nErste Zeile.\n\nZweite Zeile.\n')
  })

  it('fragt vor dem Überschreiben nach, wenn nicht frei gegeben ist', async () => {
    const chat = store.createChat({ mode: 'chat' })
    store.speichereDokument({ chatId: chat.id, pfad: join(dir, 'a.md'), art: 'markdown', titel: 'A', markdown: 'eins' })
    const innen = createDocumentRuntime({ chatId: chat.id, settings: { autoApproveWrites: false, allowCommands: false }, permissions: { ask: async () => false } })
    const k = mitDokumenten(innen, { store, chat, folder: '', autoApproveWrites: false, permissions: { ask: async () => false } })!
    const r = await k.execute('1', 'dokument_bearbeiten', { dokument: 'A', anhaengen: 'zwei' })
    expect(r).toMatchObject({ ok: false, output: 'Vom Benutzer abgelehnt.' })
  })
})

describe('Gestaltung', () => {
  const blocks = parseMarkdown('# Bewerbung\n\nSehr geehrte Damen und Herren,\n\n## Kapitel\n\nText.')

  it('setzt ohne Angabe ein normales Papier ohne Deckel', () => {
    const html = renderHtmlDocument('Bewerbung', blocks)
    expect(html).not.toContain('class="deckel"')
    expect(gestaltungAufloesen(undefined)).toMatchObject({ vorlage: 'schlicht', deckblatt: false, kapitelNeueSeite: false })
  })

  it('lässt im Brief Deckel und Titelzeile weg und hält die Kapitel im Fluss', () => {
    const html = renderHtmlDocument('Bewerbung', blocks, { gestaltung: { vorlage: 'brief' } })
    expect(html).not.toContain('class="deckel"')
    expect(html).not.toContain('dokumenttitel')
    expect(html).toContain('.kapitel + .kapitel { break-before: auto; }')
  })

  it('setzt Aufgabenlisten als Kästchen', () => {
    const html = renderHtmlDocument('B', parseMarkdown('- [ ] offen\n- [x] erledigt\n- normal'), { gestaltung: { vorlage: 'schlicht' } })
    expect(html).toContain('<li class="aufgabe">☐ offen</li>')
    expect(html).toContain('<li class="aufgabe">☑ erledigt</li>')
    expect(html).toContain('<li>normal</li>')
  })

  it('übernimmt Akzentfarbe und eigenes CSS, lässt aber keinen Ausbruch aus dem Stylesheet zu', () => {
    const html = renderHtmlDocument('B', blocks, { gestaltung: { vorlage: 'schlicht', akzent: '#1f5fa8', css: 'h2 { color: red } </style><script>x</script>' } })
    expect(html).toContain('--akzent: #1f5fa8')
    expect(html).toContain('class="dokumenttitel"')
    expect(html).not.toContain('</style><script>')
    expect(gestaltungAufloesen({ akzent: 'red; } body { display:none' }).akzent).toBeUndefined()
  })
})

describe('Vorlage ohne Angabe', () => {
  it('erkennt Anschreiben als Brief, alles andere als normales Dokument', async () => {
    const { siehtAusWieBrief } = await import('../../src/main/documents/create')
    expect(siehtAusWieBrief('Muster GmbH\n\nSehr geehrte Frau Muster,\n\nich bewerbe mich …\n\nMit freundlichen Grüßen\n\nAlex Muster')).toBe(true)
    expect(siehtAusWieBrief('# Einkaufsliste\n\n- Brot\n- Milch')).toBe(false)
  })
})

describe('Feldnamen beim Anlegen', () => {
  it('versteht deutsche und vertippte Namen der Angaben', async () => {
    const { dokumentAngaben, gestaltungAus } = await import('../../src/main/agent/tools')
    const a = dokumentAngaben({ format: 'PDF', titel: 'Jahresbericht', unternitel: 'Ein Bericht', inhalt: '# Jahresbericht\n\nText', gestaltung: { dekblatt: true, vorlage: 'klassisch' } })
    expect(a).toMatchObject({ format: 'pdf', title: 'Jahresbericht', untertitel: 'Ein Bericht', content: '# Jahresbericht\n\nText' })
    expect(gestaltungAus(a.gestaltung)).toEqual({ vorlage: 'klassisch', deckblatt: true })
    expect(dokumentAngaben({ format: 'md', content: 'x' }).format).toBe('markdown')
    // Die richtigen Namen gewinnen, wenn beides da ist.
    expect(dokumentAngaben({ content: 'richtig', inhalt: 'falsch' }).content).toBe('richtig')
  })
})
