/**
 * Dokumente erzeugen: Markdown, Word (.docx) und PDF.
 *
 * PDF entsteht über den Chromium-Drucker der App (webContents.printToPDF) —
 * kein zusätzlicher Baustein, korrekte Typografie, Umlauten inklusive.
 */
import { BrowserWindow, session } from 'electron'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join } from 'node:path'
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx'
import { gestaltungAufloesen, parseMarkdown, renderHtmlDocument, type Block, type Gestaltung, type Inline } from './markdown'
import { log } from '../logger'

export type DocKind = 'markdown' | 'docx' | 'pdf'

export const DOC_SUFFIX: Record<DocKind, string> = {
  markdown: '.md',
  docx: '.docx',
  pdf: '.pdf'
}

export interface CreateResult {
  path: string
  kind: DocKind
  bytes: number
}

export interface CreateInput {
  kind: DocKind
  /** Absoluter Zielpfad (inkl. Endung). */
  path: string
  /** Inhalt in Markdown-Schreibweise. */
  markdown: string
  /** Kopftitel für PDF und Word (fällt auf die erste Überschrift zurück). */
  title?: string
  /** Zeile unter dem Titel auf dem Deckel (nur PDF). */
  untertitel?: string
  /** Aussehen (PDF vollständig, Word: Schrift, Akzentfarbe, Titelzeile). */
  gestaltung?: Gestaltung
}

/** Anrede oder Grußformel am Zeilenanfang: dann ist es ein Anschreiben oder Brief. */
export function siehtAusWieBrief(markdown: string): boolean {
  return /^\s*(Sehr geehrte|Liebe[rs]?\s|Hallo\s|Guten Tag|Dear\s)/im.test(markdown) && /^\s*(Mit freundlichen Grüßen|Viele Grüße|Beste Grüße|Herzliche Grüße|Freundliche Grüße|Kind regards|Best regards|Sincerely)/im.test(markdown)
}

/** Erzeugt die Datei und liefert Pfad plus Bytezahl zurück. */
export async function createDocument(eingabe: CreateInput): Promise<CreateResult> {
  // Ohne ausdrückliche Vorlage: ein Brief sieht aus wie ein Brief, alles andere
  // wie ein normales Dokument — nicht wie ein gesetztes Buch mit Deckblatt.
  const input: CreateInput = eingabe.gestaltung?.vorlage
    ? eingabe
    : { ...eingabe, gestaltung: { ...eingabe.gestaltung, vorlage: siehtAusWieBrief(eingabe.markdown) ? 'brief' : 'schlicht' } }
  const blocks = parseMarkdown(input.markdown)
  await mkdir(dirname(input.path), { recursive: true })

  let bytes: Buffer
  switch (input.kind) {
    case 'markdown':
      bytes = Buffer.from(ensureTrailingNewline(input.markdown), 'utf8')
      break
    case 'docx':
      bytes = await buildDocx(blocks, resolveTitle(input, input.markdown), input.gestaltung)
      break
    case 'pdf': {
      const titel = resolveTitle(input, input.markdown)
      bytes = await buildPdf(
        renderHtmlDocument(titel, blocks, {
          untertitel: input.untertitel,
          zeile: 'Hestia',
          einbetten: (quelle) => einbetteBild(dirname(input.path), quelle),
          gestaltung: input.gestaltung
        }),
        titel,
        gestaltungAufloesen(input.gestaltung).seitenzahlen
      )
      break
    }
  }

  await writeFile(input.path, bytes)
  log.info('Dokument erstellt', { art: input.kind, pfad: input.path, bytes: bytes.byteLength })
  return { path: input.path, kind: input.kind, bytes: bytes.byteLength }
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}

function resolveTitle(input: CreateInput, markdown: string): string {
  if (input.title?.trim()) return input.title.trim()
  const heading = /^\s*#\s+(.+)$/m.exec(markdown)
  return heading?.[1]?.trim() || 'Dokument'
}

// ------------------------------------------------------------------------ Word

const HEADING_BY_LEVEL: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6
}


function inlineWord(parts: Inline[]): (TextRun | ExternalHyperlink)[] {
  return parts.flatMap((part): (TextRun | ExternalHyperlink)[] =>
    part.link && /^https?:/i.test(part.link)
      ? [new ExternalHyperlink({ children: [new TextRun({ text: part.text, style: 'Hyperlink' })], link: part.link })]
      : // Zeilenumbrüche im Absatz werden in Word zu echten Umbrüchen.
        part.text.split('\n').map(
          (stueck, i) => new TextRun({ text: stueck, bold: part.bold, italics: part.italic, font: part.code ? 'DejaVu Sans Mono' : undefined, break: i > 0 ? 1 : undefined })
        )
  )
}

function tableOf(rows: Inline[][][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (row, rowIndex) =>
        new TableRow({
          children: row.map(
            (cell) =>
              new TableCell({
                shading: rowIndex === 0 ? { type: ShadingType.CLEAR, fill: 'F2F0EC' } : undefined,
                margins: { top: 80, bottom: 80, left: 110, right: 110 },
                children: [new Paragraph({ children: inlineWord(cell) })]
              })
          )
        })
    )
  })
}

async function buildDocx(blocks: Block[], title: string, gestaltungRoh?: Gestaltung): Promise<Buffer> {
  const gestaltung = gestaltungAufloesen(gestaltungRoh)
  // Word kennt nur Hex ohne Raute; Farbnamen bleiben bei der Vorgabe.
  const akzent = /^#[0-9a-f]{6}$/i.test(gestaltung.akzent ?? '') ? gestaltung.akzent!.slice(1) : undefined
  const schrift = gestaltung.schrift === 'serif' ? 'DejaVu Serif' : 'DejaVu Sans'
  // Ein Brief hat keine Titelzeile — er beginnt mit dem, was darin steht.
  const children: (Paragraph | Table)[] =
    gestaltung.vorlage === 'brief'
      ? []
      : [
          new Paragraph({
            children: [new TextRun({ text: title, color: akzent })],
            heading: HeadingLevel.TITLE,
            spacing: { after: 240 }
          })
        ]

  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const first = block.inline.map((part) => new TextRun({ text: part.text, bold: part.bold, italics: part.italic, color: akzent }))
        children.push(
          new Paragraph({
            heading: HEADING_BY_LEVEL[Math.min(Math.max(block.level, 1), 6)],
            spacing: { before: 240, after: 120 },
            children: first
          })
        )
        break
      }
      case 'paragraph':
        children.push(new Paragraph({ children: inlineWord(block.inline), spacing: { after: 140 } }))
        break
      case 'bullets':
        for (const item of block.items) {
          children.push(new Paragraph({ children: inlineWord(item), bullet: { level: 0 }, spacing: { after: 60 } }))
        }
        break
      case 'numbered':
        for (const item of block.items) {
          children.push(new Paragraph({ children: inlineWord(item), numbering: { reference: 'hestia-nummern', level: 0 }, spacing: { after: 60 } }))
        }
        break
      case 'quote':
        children.push(
          new Paragraph({
            children: block.inline.map((part) => new TextRun({ text: part.text, italics: true, color: '5A554C' })),
            indent: { left: 480 },
            spacing: { after: 140 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'D6CFC4', space: 8 } }
          })
        )
        break
      case 'code':
        for (const line of block.text.split('\n')) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: line.length > 0 ? line : ' ', font: 'DejaVu Sans Mono', size: 19 })],
              shading: { type: ShadingType.CLEAR, fill: 'F7F6F3' },
              spacing: { after: 0 }
            })
          )
        }
        break
      case 'table':
        children.push(tableOf(block.rows))
        children.push(new Paragraph({ text: '', spacing: { after: 120 } }))
        break
      case 'rule':
        children.push(
          new Paragraph({
            text: '',
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'DCD7CD' } },
            spacing: { after: 200 }
          })
        )
        break
    }
  }

  const doc = new Document({
    title,
    creator: 'Hestia',
    description: 'In Hestia erzeugtes Dokument',
    numbering: {
      config: [
        {
          reference: 'hestia-nummern',
          levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }]
        }
      ]
    },
    styles: {
      default: {
        document: { run: { font: schrift, size: 22, color: '1B1A17' } }
      }
    },
    sections: [{ properties: {}, children }]
  })

  return Packer.toBuffer(doc)
}

/**
 * Bild in die Dokumentseite einbetten.
 *
 * Die Druckseite wird als data:-Dokument geladen; dort gibt es keinen Ordner,
 * gegen den ein relativer Pfad aufgelöst werden könnte. Also wandert der
 * Bildpunkt selbst in die Seite. Was fehlt, bleibt ein Bild ohne Inhalt —
 * kein Grund, das ganze Dokument fallen zu lassen.
 */
const BILDENDUNGEN = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])

function einbetteBild(basis: string, quelle: string): string | null {
  if (/^data:image\//i.test(quelle)) return quelle
  // Aus dem Netz wird im PDF nichts geladen (das Druckfenster hat keinen Zugang).
  if (/^(https?:|\/\/|data:)/i.test(quelle)) return ''
  // Nur echte Bilddateien: Sonst ließe sich mit ![](…) jede beliebige Datei als
  // „Bild“ ins PDF schmuggeln.
  const pfad = isAbsolute(quelle) ? quelle : join(basis, quelle)
  if (!BILDENDUNGEN.has(extname(pfad).toLowerCase())) return ''
  {
    try {
      const bytes = readFileSync(pfad)
      const endung = extname(pfad).toLowerCase().replace('.', '')
      const typ = endung === 'svg' ? 'image/svg+xml' : endung === 'jpg' ? 'image/jpeg' : `image/${endung || 'png'}`
      return `data:${typ};base64,${bytes.toString('base64')}`
    } catch {
      /* fehlt — dann eben ohne Bild */
    }
  }
  return null
}

/** Die Fußzeile wird als HTML gebaut, also wird der Titel erst unschädlich. */
function unschadlich(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ------------------------------------------------------------------------- PDF

const DRUCK_SITZUNG = 'hestia-druck'
let abgeschottet = false

/** Die Drucksitzung lässt nur die eine Druckdatei und eingebettete Bilder zu. */
function druckSitzungAbschotten(): void {
  if (abgeschottet) return
  abgeschottet = true
  session.fromPartition(DRUCK_SITZUNG).webRequest.onBeforeRequest((anfrage, antwort) => {
    const erlaubt = /^data:/i.test(anfrage.url) || (/^file:/i.test(anfrage.url) && /hestia-druck-[0-9a-f-]+\.html$/i.test(decodeURIComponent(anfrage.url)))
    antwort({ cancel: !erlaubt })
  })
}

/**
 * HTML → PDF über den eingebauten Drucker. Das Fenster bleibt unsichtbar;
 * wichtig: auf fertige Schriften warten, sonst schneidet Chromium zu früh ab.
 */
async function buildPdf(html: string, titel: string, seitenzahlen = true): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    // Eigene Sitzung ohne Netz: Was im Dokument steht (auch vom Modell nach dem
    // Lesen einer Webseite geschrieben), soll beim Setzen nichts abrufen können.
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: false, partition: DRUCK_SITZUNG }
  })
  druckSitzungAbschotten()
  // Aus einer Datei laden statt als data:-Adresse — die ist in Chromium auf
  // etwa 2 MB begrenzt, und ein Bilderbuch mit Fotos blieb sonst ohne PDF.
  const datei = join(tmpdir(), `hestia-druck-${randomUUID()}.html`)
  await writeFile(datei, html, 'utf8')

  try {
    await win.webContents.loadFile(datei)
    await win.webContents.executeJavaScript('document.fonts ? document.fonts.ready : true')

    // Blattmaß in Zoll (A4) und eigene Ränder: nur so bleibt unter dem Satz
    // noch Raum für die Fußzeile mit der Seitenzahl.
    const fusszeile =
      '<div style="display:flex;width:100%;font:8pt sans-serif;color:#8b857c;padding:0 18mm 4mm">' +
      `<span style="flex:1 1 0;overflow:hidden;white-space:nowrap">${unschadlich(titel)}</span>` +
      '<span>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></span></div>'
    const printed = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: false,
      generateDocumentOutline: true,
      displayHeaderFooter: seitenzahlen,
      headerTemplate: '<span></span>',
      footerTemplate: fusszeile,
      pageSize: 'A4',
      margins: { marginType: 'custom', top: 0.79, bottom: seitenzahlen ? 0.95 : 0.79, left: 0.71, right: 0.71 }
    })
    return Buffer.from(printed)
  } finally {
    win.destroy()
    await rm(datei, { force: true })
  }
}
