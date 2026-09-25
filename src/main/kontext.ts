/**
 * Projekt-Kontext: Text aus den Dateien holen, die jemand in ein Projekt legt
 * (Lebenslauf, Portfolio, Notizen …), und entscheiden, wie er das Modell
 * erreicht.
 *
 * Kleine Projekte gehen komplett in den Systemprompt. Wird es mehr, schaltet
 * das Projekt in den Suchmodus: dann steht im Prompt nur, welche Dateien es
 * gibt, und das Modell sucht per Werkzeug im Volltextindex (SQLite FTS5) —
 * als Suchmodus, ohne Zusatzmodell. Ein Embedding-Modell
 * über Ollama würde am RAM-Gate hängen, sobald llama.cpp etwas geladen hat.
 */
import { inflateRawSync } from 'node:zlib'
import { extname } from 'node:path'

/** Obergrenze eines Projekts in Zeichen (grob 500 000 Token). */
export const KAPAZITAET = 2_000_000

/**
 * Bis zu dieser Summe geht alles komplett in den Prompt (grob 15 000 Token).
 * Darüber wird gesucht: Ein lokales Modell müsste den ganzen Text sonst bei
 * jeder neuen Unterhaltung erst einlesen — bei 250 Token/s eine Minute Warten.
 */
export const VOLLSTAENDIG_BIS = 60_000

/** Größte Datei, die angenommen wird. */
export const MAX_DATEI = 30 * 1024 * 1024

const TEXTARTEN = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.xml', '.yaml', '.yml', '.log', '.ini', '.toml',
  '.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.h', '.cpp', '.cs', '.go', '.rs', '.rb', '.php', '.sh', '.sql', '.css', '.tex'
])

export interface Gelesen {
  /** Kurzform für die Kachel. */
  art: string
  text: string
}

/** Liest den Text einer Datei; wirft mit verständlicher Meldung, wenn es nicht geht. */
export async function textAusDatei(name: string, daten: Buffer): Promise<Gelesen> {
  const endung = extname(name).toLowerCase()
  const art = (endung.slice(1) || 'datei').toUpperCase()
  if (daten.length > MAX_DATEI) throw new Error(`„${name}“ ist größer als 30 MB.`)

  let text: string
  if (endung === '.pdf') text = await pdfText(daten)
  else if (endung === '.docx') text = wordText(entpacke(daten, 'word/document.xml'))
  else if (endung === '.odt') text = odfText(entpacke(daten, 'content.xml'))
  else if (endung === '.html' || endung === '.htm') text = htmlText(daten.toString('utf8'))
  else if (TEXTARTEN.has(endung) || istText(daten)) text = daten.toString('utf8')
  else throw new Error(`„${name}“: Dieses Format kann ich nicht lesen. Möglich sind PDF, Word (.docx), OpenDocument (.odt), HTML und Textdateien.`)

  text = aufraeumen(text)
  if (!text) throw new Error(`„${name}“ enthält keinen lesbaren Text (etwa ein eingescanntes PDF ohne Texterkennung).`)
  return { art, text }
}

/** Mehrfache Leerzeilen und Leerzeichen zusammenziehen — spart Prompt ohne Inhalt zu verlieren. */
function aufraeumen(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Sieht der Anfang nach Text aus (kein Nullbyte, fast nur druckbare Zeichen)? */
function istText(daten: Buffer): boolean {
  const probe = daten.subarray(0, 4096)
  if (probe.includes(0)) return false
  const text = probe.toString('utf8')
  const unlesbar = (text.match(/�/g) ?? []).length
  return unlesbar < text.length * 0.02
}

async function pdfText(daten: Buffer): Promise<string> {
  // Das Legacy-Paket läuft in Node ohne Browser-APIs; der Arbeiter läuft dann im selben Prozess.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const aufgabe = pdfjs.getDocument({ data: new Uint8Array(daten), useSystemFonts: true })
  const dokument = await aufgabe.promise
  const seiten: string[] = []
  try {
    for (let nr = 1; nr <= dokument.numPages; nr++) {
      const inhalt = await (await dokument.getPage(nr)).getTextContent()
      seiten.push(
        inhalt.items
          .map((teil) => ('str' in teil ? teil.str + (teil.hasEOL ? '\n' : '') : ''))
          .join('')
      )
    }
  } finally {
    await aufgabe.destroy()
  }
  return seiten.join('\n\n')
}

/**
 * Eine einzelne Datei aus einem ZIP holen (DOCX und ODT sind ZIP-Archive).
 * Liest das zentrale Verzeichnis am Ende — dort stehen die verlässlichen
 * Größen, auch wenn der lokale Kopf sie offenlässt.
 */
function entpacke(zip: Buffer, gesucht: string): string {
  let ende = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      ende = i
      break
    }
  }
  if (ende < 0) throw new Error('Die Datei ist kein gültiges Office-Dokument (kein ZIP-Verzeichnis gefunden).')
  const eintraege = zip.readUInt16LE(ende + 10)
  let pos = zip.readUInt32LE(ende + 16)
  for (let n = 0; n < eintraege; n++) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) break
    const verfahren = zip.readUInt16LE(pos + 10)
    const gepackt = zip.readUInt32LE(pos + 20)
    const nameLaenge = zip.readUInt16LE(pos + 28)
    const extraLaenge = zip.readUInt16LE(pos + 30)
    const kommentarLaenge = zip.readUInt16LE(pos + 32)
    const kopf = zip.readUInt32LE(pos + 42)
    const name = zip.toString('utf8', pos + 46, pos + 46 + nameLaenge)
    if (name === gesucht) {
      const start = kopf + 30 + zip.readUInt16LE(kopf + 26) + zip.readUInt16LE(kopf + 28)
      const roh = zip.subarray(start, start + gepackt)
      if (verfahren === 0) return roh.toString('utf8')
      if (verfahren === 8) return inflateRawSync(roh).toString('utf8')
      throw new Error('Das Dokument ist mit einem unbekannten Verfahren gepackt.')
    }
    pos += 46 + nameLaenge + extraLaenge + kommentarLaenge
  }
  throw new Error(`Im Dokument fehlt ${gesucht}.`)
}

const ENTITAETEN: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function entitaeten(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (ganz, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(parseInt(code.slice(2), 16))
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10))
    return ENTITAETEN[code.toLowerCase()] ?? ganz
  })
}

/** WordprocessingML: Absätze, Zeilenumbrüche und Tabulatoren erhalten, den Rest entfernen. */
function wordText(xml: string): string {
  return entitaeten(
    xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:(br|cr)\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/w:tc>/g, '\t')
      .replace(/<[^>]+>/g, '')
  )
}

function odfText(xml: string): string {
  return entitaeten(
    xml
      .replace(/<text:tab\/>/g, '\t')
      .replace(/<text:line-break\/>/g, '\n')
      .replace(/<\/text:(p|h)>/g, '\n')
      .replace(/<[^>]+>/g, '')
  )
}

function htmlText(html: string): string {
  return entitaeten(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
}
