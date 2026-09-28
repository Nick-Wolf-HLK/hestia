/**
 * Briefe und Anschreiben aus festen Feldern.
 *
 * Lokale Modelle bauen einen Brief als freien Text jedes Mal anders — Adressen
 * als Überschriften, Linien, doppelte Betreffzeilen. Hier füllt das Modell nur
 * Felder aus; Aufbau und Satz (nach DIN 5008) kommen immer von Hestia.
 */
import { escapeHtml, parseInline, parseMarkdown, type Block, type Inline } from './markdown'

export interface Brief {
  absender: string[]
  empfaenger: string[]
  ortDatum: string
  betreff: string
  bezug?: string
  anrede: string
  /** Brieftext: Absätze, Aufzählungen mit „- “ erlaubt. */
  text: string
  gruss: string
  name: string
  anlagen: string[]
}

/** Andere Namen, unter denen Modelle die Felder liefern. */
const FELDER: Record<keyof Brief, string[]> = {
  absender: ['absender', 'sender', 'von', 'from', 'absenderadresse', 'absender_adresse'],
  empfaenger: ['empfaenger', 'empfänger', 'empfanger', 'recipient', 'an', 'to', 'adressat', 'empfaengeradresse', 'empfänger_adresse'],
  ortDatum: ['ortDatum', 'ort_datum', 'ortdatum', 'datum', 'date', 'ort_und_datum'],
  betreff: ['betreff', 'subject', 'betreffzeile', 'thema'],
  bezug: ['bezug', 'referenz', 'reference', 'kennziffer', 'referenznummer', 'ihr_zeichen'],
  anrede: ['anrede', 'salutation', 'begruessung', 'begrüßung'],
  text: ['text', 'brieftext', 'inhalt', 'body', 'content', 'haupttext'],
  gruss: ['gruss', 'gruß', 'grussformel', 'grußformel', 'closing', 'schlussformel'],
  name: ['name', 'unterschrift', 'signatur', 'signature', 'unterzeichner'],
  anlagen: ['anlagen', 'anlage', 'attachments', 'anhang', 'anhaenge', 'anhänge']
}

/** Woran man erkennt, dass das Modell die Brief-Felder direkt in die Angaben gelegt hat. */
const BRIEF_KENNZEICHEN = ['empfaenger', 'empfänger', 'recipient', 'anrede', 'betreff', 'absender']

function holen(quelle: Record<string, unknown>, namen: string[]): unknown {
  for (const name of namen) {
    const wert = quelle[name] ?? quelle[name.toLowerCase()]
    if (wert !== undefined && wert !== null && wert !== '') return wert
  }
  return undefined
}

/** Zeilen aus Text oder Liste; Markdown-Reste (#, **, ---) fallen weg. */
function zeilen(wert: unknown): string[] {
  const roh = Array.isArray(wert) ? wert.map(String) : typeof wert === 'string' ? wert.split(/\r?\n|\s*\|\s*/) : []
  return roh
    .map((z) => z.replace(/^\s*(#+|[-*•]|\d+\.)\s+/, '').replace(/\*\*|__/g, '').trim())
    .filter((z) => z && !/^[-–—_*=]{3,}$/.test(z))
}

function einzeilig(wert: unknown): string {
  return zeilen(wert).join(' ').trim()
}

/**
 * JSON, wie kleine Modelle es schreiben: oft mit einer Klammer zu viel am Ende
 * oder mit Text drumherum. Genommen wird das erste vollständige Objekt.
 */
export function jsonNachsichtig(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    /* weiter unten */
  }
  const start = text.indexOf('{')
  if (start < 0) return undefined
  let tiefe = 0
  let inText = false
  for (let i = start; i < text.length; i++) {
    const z = text[i]
    if (inText) {
      if (z === '\\') i++
      else if (z === '"') inText = false
    } else if (z === '"') inText = true
    else if (z === '{') tiefe++
    else if (z === '}' && --tiefe === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1))
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

export function heute(): string {
  return new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Brief-Angaben des Modells lesen: aus `brief` (auch als JSON-Text) oder aus
 * Feldern, die direkt neben `format` stehen. Null, wenn es kein Brief ist.
 */
export function briefAus(args: Record<string, unknown>): Brief | null {
  let quelle: unknown = args.brief ?? args.letter ?? args.anschreiben
  if (typeof quelle === 'string') quelle = jsonNachsichtig(quelle)
  if (!quelle || typeof quelle !== 'object') {
    // Kleine Modelle legen die Felder gern direkt in die Angaben.
    if (!BRIEF_KENNZEICHEN.some((k) => args[k] !== undefined)) return null
    quelle = args
  }
  const q = quelle as Record<string, unknown>

  const anrede = einzeilig(holen(q, FELDER.anrede)) || 'Sehr geehrte Damen und Herren,'
  const gruss = einzeilig(holen(q, FELDER.gruss)) || 'Mit freundlichen Grüßen'
  const absender = zeilen(holen(q, FELDER.absender))
  const name = einzeilig(holen(q, FELDER.name)) || absender[0] || ''
  const text = bereinigeText(String(holen(q, FELDER.text) ?? ''), anrede, gruss)

  return {
    absender,
    empfaenger: zeilen(holen(q, FELDER.empfaenger)),
    ortDatum: einzeilig(holen(q, FELDER.ortDatum)) || heute(),
    betreff: einzeilig(holen(q, FELDER.betreff)).replace(/^betreff:\s*/i, ''),
    bezug: einzeilig(holen(q, FELDER.bezug)) || undefined,
    anrede: /[,!]$/.test(anrede) ? anrede : `${anrede},`,
    text,
    gruss,
    name,
    anlagen: zeilen(holen(q, FELDER.anlagen))
  }
}

/**
 * Was das Modell zusätzlich in den Brieftext geschrieben hat, obwohl es ein
 * eigenes Feld hat: Anrede am Anfang, Grußformel samt Name am Ende, Linien.
 */
function bereinigeText(text: string, anrede: string, gruss: string): string {
  let t = text.replace(/\r\n/g, '\n').trim()
  const anfang = anrede.replace(/[,!]$/, '').trim()
  if (anfang && t.toLowerCase().startsWith(anfang.toLowerCase())) t = t.slice(anfang.length).replace(/^[,!]?\s*/, '')
  else t = t.replace(/^(Sehr geehrte[^\n]*|Liebe[rs]? [^\n]*|Hallo[^\n]*|Guten Tag[^\n]*)\n/i, '')
  const grussStelle = t.toLowerCase().lastIndexOf(gruss.toLowerCase())
  const gruesse = /\n\s*(Mit freundlichen Grüßen|Viele Grüße|Beste Grüße|Herzliche Grüße|Freundliche Grüße)[\s\S]*$/i
  t = grussStelle > 0 ? t.slice(0, grussStelle) : t.replace(gruesse, '')
  return t
    .split('\n')
    .filter((z) => !/^\s*[-–—_*=]{3,}\s*$/.test(z))
    .join('\n')
    .trim()
}

/** Brieftext als Bausteine; Überschriften werden fette Zeilen, Tabellen und Linien fallen weg. */
export function briefBloecke(text: string): Block[] {
  return parseMarkdown(text).flatMap((b): Block[] => {
    if (b.type === 'heading') return [{ type: 'paragraph', inline: b.inline.map((i) => ({ ...i, bold: true })) }]
    if (b.type === 'rule' || b.type === 'image') return []
    return [b]
  })
}

/** Der Brief als Markdown (für .md und als Klartext). */
export function briefAlsMarkdown(b: Brief): string {
  const teile = [
    b.absender.join('  \n'),
    b.empfaenger.join('  \n'),
    b.ortDatum,
    `**${b.betreff}**${b.bezug ? `  \n${b.bezug}` : ''}`,
    b.anrede,
    b.text,
    `${b.gruss}\n\n\n${b.name}`,
    b.anlagen.length ? `**Anlagen**\n\n${b.anlagen.map((a) => `- ${a}`).join('\n')}` : ''
  ]
  return `${teile.filter((t) => t.trim()).join('\n\n')}\n`
}

// ------------------------------------------------------------------------ PDF

function inlineHtml(teile: Inline[]): string {
  return teile
    .map((t) => {
      let html = escapeHtml(t.text).replace(/\n/g, '<br>')
      if (t.code) html = `<code>${html}</code>`
      if (t.italic) html = `<em>${html}</em>`
      if (t.bold) html = `<strong>${html}</strong>`
      return html
    })
    .join('')
}

function bloeckeHtml(bloecke: Block[]): string {
  return bloecke
    .map((b) => {
      switch (b.type) {
        case 'paragraph':
          return `<p>${inlineHtml(b.inline)}</p>`
        case 'bullets':
          return `<ul>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join('')}</ul>`
        case 'numbered':
          return `<ol>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join('')}</ol>`
        case 'quote':
          return `<p><em>${inlineHtml(b.inline)}</em></p>`
        case 'code':
          return `<p>${escapeHtml(b.text).replace(/\n/g, '<br>')}</p>`
        case 'table':
          return b.rows.map((r) => `<p>${r.map(inlineHtml).join(' · ')}</p>`).join('')
        default:
          return ''
      }
    })
    .join('\n')
}

/** Vollständige Druckseite des Briefs (A4, Ränder setzt der Drucker). */
export function briefHtml(b: Brief, schrift: 'sans' | 'serif' = 'sans'): string {
  const familie = schrift === 'serif' ? 'Georgia, "Times New Roman", serif' : 'Arial, Helvetica, sans-serif'
  const [kopfName, ...kopfRest] = b.absender
  const absender = kopfName
    ? `<header class="absender"><div class="absender__name">${escapeHtml(kopfName)}</div>${
        kopfRest.length ? `<div class="absender__rest">${kopfRest.map(escapeHtml).join(' · ')}</div>` : ''
      }</header>`
    : ''
  const anlagen = b.anlagen.length
    ? `<section class="anlagen"><strong>Anlagen</strong><ul>${b.anlagen.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul></section>`
    : ''
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(b.betreff)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 10.5pt/1.45 ${familie}; color: #1b1a17; }
  .absender { border-bottom: 1px solid #cfc8bc; padding-bottom: 3mm; margin-bottom: 12mm; }
  .absender__name { font-size: 14pt; font-weight: 700; }
  .absender__rest { font-size: 9pt; color: #5b5650; margin-top: 1mm; }
  .empfaenger { min-height: 30mm; margin-bottom: 8mm; }
  .datum { text-align: right; margin-bottom: 8mm; }
  .betreff { font-weight: 700; margin: 0 0 1mm; }
  .bezug { margin: 0; }
  .anrede { margin: 8mm 0 4mm; }
  p { margin: 0 0 3.2mm; }
  ul, ol { margin: 0 0 3.2mm; padding-left: 6mm; }
  li { margin-bottom: 1mm; }
  .gruss { margin-top: 6mm; }
  .name { margin-top: 14mm; }
  .anlagen { margin-top: 8mm; font-size: 9.5pt; }
  .anlagen ul { margin-top: 1mm; }
</style></head><body>
${absender}
<div class="empfaenger">${b.empfaenger.map(escapeHtml).join('<br>')}</div>
<div class="datum">${escapeHtml(b.ortDatum)}</div>
<p class="betreff">${inlineHtml(parseInline(b.betreff))}</p>
${b.bezug ? `<p class="bezug">${escapeHtml(b.bezug)}</p>` : ''}
<p class="anrede">${escapeHtml(b.anrede)}</p>
${bloeckeHtml(briefBloecke(b.text))}
<p class="gruss">${escapeHtml(b.gruss)}</p>
<p class="name">${escapeHtml(b.name)}</p>
${anlagen}
</body></html>`
}

// ------------------------------------------------------------------ Quelle

/*
 * Gespeicherte Quelle eines Briefs (für dokument_lesen/-bearbeiten): Felder in
 * lesbaren Zeilen, mehrzeilige Angaben mit „ | “ getrennt, der Brieftext am
 * Ende. Das Modell kann darin Wörter ersetzen; gesetzt wird wieder als Brief.
 */
const QUELLE_KOPF = '[brief]'

export function briefAlsQuelle(b: Brief): string {
  const zeile = (name: string, wert: string | undefined): string => (wert ? `${name}: ${wert}\n` : '')
  return (
    `${QUELLE_KOPF}\n` +
    zeile('absender', b.absender.join(' | ')) +
    zeile('empfaenger', b.empfaenger.join(' | ')) +
    zeile('ort_datum', b.ortDatum) +
    zeile('betreff', b.betreff) +
    zeile('bezug', b.bezug) +
    zeile('anrede', b.anrede) +
    zeile('gruss', b.gruss) +
    zeile('name', b.name) +
    zeile('anlagen', b.anlagen.join(' | ')) +
    `text:\n${b.text}\n`
  )
}

export function briefAusQuelle(markdown: string): Brief | null {
  const t = markdown.replace(/\r\n/g, '\n')
  if (!t.trimStart().startsWith(QUELLE_KOPF)) return null
  const rumpf = t.trimStart().slice(QUELLE_KOPF.length)
  const textStelle = rumpf.search(/^text:\s*$/m)
  const kopf = textStelle >= 0 ? rumpf.slice(0, textStelle) : rumpf
  const felder: Record<string, unknown> = {}
  for (const z of kopf.split('\n')) {
    const m = /^\s*([a-zäöü_]+)\s*:\s*(.*)$/i.exec(z)
    if (m?.[1]) felder[m[1].toLowerCase()] = m[2] ?? ''
  }
  felder.text = textStelle >= 0 ? rumpf.slice(textStelle).replace(/^text:\s*\n?/, '') : ''
  return briefAus({ brief: felder })
}
