/**
 * Kleiner Markdown-Parser für Dokumentausgaben.
 *
 * Bewusst kein Voll-Power-Parser: benötigt werden Blöcke, die man sauber in
 * Word und in ein Druck-HTML übersetzen kann. Zeilenweise, vorhersehbar, testbar.
 */
import { herdschaleSvg } from '@shared/marke'

export interface Inline {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
  link?: string
}

export type Block =
  | { type: 'heading'; level: number; inline: Inline[] }
  | { type: 'paragraph'; inline: Inline[] }
  | { type: 'bullets'; items: Inline[][] }
  | { type: 'numbered'; items: Inline[][] }
  | { type: 'quote'; inline: Inline[] }
  | { type: 'code'; text: string; language?: string }
  | { type: 'table'; rows: Inline[][][]; hasHeader: boolean }
  | { type: 'rule' }
  | { type: 'image'; src: string; label?: string }

/** Inline-Auszeichnung: Fett, Kursiv, Code, Links. Rest bleibt roher Text. */
export function parseInline(input: string): Inline[] {
  const out: Inline[] = []
  let rest = input
  const patterns: { re: RegExp; make: (m: RegExpExecArray) => Inline }[] = [
    { re: /^`([^`]+)`/, make: (m) => ({ text: m[1]!, code: true }) },
    { re: /^\*\*\*([^*]+)\*\*\*/, make: (m) => ({ text: m[1]!, bold: true, italic: true }) },
    { re: /^\*\*([^*]+)\*\*/, make: (m) => ({ text: m[1]!, bold: true }) },
    { re: /^__([^_]+)__,?/, make: (m) => ({ text: m[1]!, bold: true }) },
    { re: /^\*([^*]+)\*/, make: (m) => ({ text: m[1]!, italic: true }) },
    { re: /^_([^_]+)_/, make: (m) => ({ text: m[1]!, italic: true }) },
    { re: /^\[([^\]]+)\]\(([^)\s]+)\)/, make: (m) => ({ text: m[1]!, link: m[2]! }) }
  ]

  let plain = ''
  while (rest.length > 0) {
    let matched = false
    for (const pattern of patterns) {
      const m = pattern.re.exec(rest)
      if (!m) continue
      if (plain) {
        out.push({ text: plain })
        plain = ''
      }
      out.push(pattern.make(m))
      rest = rest.slice(m[0].length)
      matched = true
      break
    }
    if (!matched) {
      plain += rest[0]
      rest = rest.slice(1)
    }
  }
  if (plain) out.push({ text: plain })
  return out
}

const BULLET_RE = /^\s*[-*+]\s+(.*)$/
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/
const TABLE_SPLIT = /\s*\|\s*/

function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-')
}

const BILD_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/

export function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]!

    if (line.trim() === '') {
      index++
      continue
    }

    // Codeblock mit drei Backticks — Sprache wird übergeben, aber nicht interpretiert.
    const fence = /^\s*```(\w*)\s*$/.exec(line)
    if (fence) {
      const body: string[] = []
      index++
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index]!)) {
        body.push(lines[index]!)
        index++
      }
      index++
      blocks.push({ type: 'code', text: body.join('\n'), language: fence[1] || undefined })
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1]!.length, inline: parseInline(heading[2]!) })
      index++
      continue
    }

    const bild = BILD_RE.exec(line.trim())
    if (bild) {
      blocks.push({ type: 'image', src: bild[2]!, label: bild[1] || undefined })
      index++
      continue
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push({ type: 'rule' })
      index++
      continue
    }

    if (line.trimStart().startsWith('>')) {
      const quote: string[] = []
      while (index < lines.length && lines[index]!.trimStart().startsWith('>')) {
        quote.push(lines[index]!.trimStart().replace(/^>\s?/, ''))
        index++
      }
      blocks.push({ type: 'quote', inline: parseInline(quote.join(' ')) })
      continue
    }

    // Tabelle: Kopfzeile + Trennzeile mit Gedankenstrichen
    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1]!)) {
      const rows: Inline[][][] = []
      const readRow = (raw: string): Inline[][] =>
        raw
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split(TABLE_SPLIT)
          .map((cell) => parseInline(cell.trim()))

      rows.push(readRow(line))
      index += 2
      while (index < lines.length && lines[index]!.includes('|') && lines[index]!.trim() !== '') {
        rows.push(readRow(lines[index]!))
        index++
      }
      blocks.push({ type: 'table', rows, hasHeader: true })
      continue
    }

    if (BULLET_RE.test(line)) {
      const items: Inline[][] = []
      while (index < lines.length && BULLET_RE.test(lines[index]!)) {
        // Aufgabenlisten wie in GitHub: „[ ]“ und „[x]“ werden Kästchen.
        const eintrag = BULLET_RE.exec(lines[index]!)![1]!.replace(/^\[ \]\s+/, '☐ ').replace(/^\[[xX]\]\s+/, '☑ ')
        items.push(parseInline(eintrag))
        index++
      }
      blocks.push({ type: 'bullets', items })
      continue
    }

    if (ORDERED_RE.test(line)) {
      const items: Inline[][] = []
      while (index < lines.length && ORDERED_RE.test(lines[index]!)) {
        items.push(parseInline(ORDERED_RE.exec(lines[index]!)![1]!))
        index++
      }
      blocks.push({ type: 'numbered', items })
      continue
    }

    // Absatz: alles bis zur nächsten Leerzeile oder Sonderform
    const paragraph: string[] = []
    while (
      index < lines.length &&
      lines[index]!.trim() !== '' &&
      !/^(#{1,6})\s/.test(lines[index]!) &&
      !BULLET_RE.test(lines[index]!) &&
      !ORDERED_RE.test(lines[index]!) &&
      !/^\s*```/.test(lines[index]!) &&
      !lines[index]!.trimStart().startsWith('>')
    ) {
      paragraph.push(lines[index]!)
      index++
    }
    // Ein einfacher Zeilenumbruch bleibt einer (wie bei GitHub): Grußformel,
    // Anschrift und Absender stünden sonst in einer Zeile.
    blocks.push({ type: 'paragraph', inline: parseInline(paragraph.map((zeile) => zeile.replace(/\s+$/, '')).join('\n')) })
  }

  return blocks
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inlineHtml(parts: Inline[]): string {
  return parts
    .map((part) => {
      let html = escapeHtml(part.text).replace(/\n/g, '<br>')
      if (part.code) html = `<code>${html}</code>`
      if (part.bold) html = `<strong>${html}</strong>`
      if (part.italic) html = `<em>${html}</em>`
      if (part.link && /^https?:/i.test(part.link)) html = `<a>${html}</a>`
      return html
    })
    .join('')
}

/**
 * Druckvorlage: ein gesetztes Heft, kein Ausdruck aus dem Editor.
 *
 * Die Regeln hält Chromium beim Drucken ein (printToPDF). Bewusst serifig,
 * mit breitem Zeilenraster, Silbentrennung und verwitweten Zeilen im Zaum —
 * das ist der Unterschied zwischen „eine PDF" und „einem Dokument".
 */
export const PRINT_CSS = `
  @page { size: A4; margin: 20mm 18mm 22mm; }
  * { box-sizing: border-box; }
  :root {
    --tinte: #1b1a17;
    --milde: #5b5650;
    --ferne: #8b857c;
    --akzent: #b4551d;
    --linie: #ded8ce;
    --schatten: #f6f3ee;
  }
  body {
    margin: 0;
    color: var(--tinte);
    font: 11pt/1.66 "DejaVu Serif", "Liberation Serif", Georgia, serif;
    font-variant-numeric: oldstyle-nums;
  }
  p { margin: 0 0 .82em; text-align: justify; hyphens: auto; orphans: 2; widows: 2; }

  /* Der Deckel trägt den Titel allein und füllt die erste Seite. */
  .deckel { min-height: 246mm; display: flex; flex-direction: column; break-after: page; }
  .deckel__horn {
    display: flex; align-items: center; gap: 2.2mm;
    margin-top: 30mm;
    font: 600 8.5pt/1.4 "DejaVu Sans", system-ui, sans-serif;
    letter-spacing: .22em; text-transform: uppercase; color: var(--akzent);
  }
  .deckel h1 {
    margin: 8mm 0 0; font-size: 31pt; line-height: 1.1; font-weight: 600;
    text-align: left; text-wrap: balance;
  }
  .deckel__steg {
    margin-top: 6mm; padding-top: 5mm; border-top: 2px solid var(--akzent);
    font-size: 12.5pt; line-height: 1.5; color: var(--milde); font-style: italic;
  }
  .deckel__bild { margin-top: auto; }
  .deckel__bild img { width: 100%; max-height: 96mm; object-fit: cover; }
  .deckel__fuss {
    margin-top: 10mm; padding-top: 4mm; border-top: 1px solid var(--linie);
    font: 9pt/1.5 "DejaVu Sans", system-ui, sans-serif; color: var(--ferne);
    display: flex; justify-content: space-between; gap: 10mm;
  }

  h1, h2, h3, h4, h5, h6 { break-after: avoid; font-weight: 600; line-height: 1.18; }
  h1 { font-size: 19pt; margin: 0 0 7mm; }
  /* Ein Kapitel beginnt auf einer neuen Seite — in jeder Kapiteltiefe. */
  .kapitel + .kapitel { break-before: page; }
  .kapitel > h1, .kapitel > h2 { padding-bottom: 3mm; border-bottom: 1px solid var(--akzent); }
  .kapitel > p:first-of-type::first-letter {
    float: left; font-size: 32pt; line-height: .84; padding: 1mm 2mm 0 0; color: var(--akzent);
  }
  h2 { font-size: 14pt; margin: 8mm 0 2.5mm; }
  h3 { font-size: 12pt; margin: 6mm 0 2mm; color: var(--milde); }
  h4, h5, h6 { font-size: 11pt; margin: 5mm 0 1.5mm; }
  .horn {
    font: 600 8pt/1.4 "DejaVu Sans", system-ui, sans-serif;
    letter-spacing: .2em; text-transform: uppercase; color: var(--akzent); margin: 0 0 2mm;
  }

  ul, ol { margin: 0 0 .9em; padding-left: 1.35em; }
  li { margin: 0 0 .3em; text-align: left; }
  li::marker { color: var(--akzent); }
  li.aufgabe { list-style: none; margin-left: -1.1em; }
  .bild-fehlt { color: var(--ferne); font-style: italic; text-align: left; }
  a { color: var(--akzent); text-decoration: none; }

  figure { margin: 4mm 0 5mm; break-inside: avoid; text-align: center; }
  figure + p, .galerie + p { margin-top: 3mm; }
  figure img { max-width: 100%; max-height: 170mm; }
  figcaption {
    margin-top: 2mm; font: italic 9pt/1.45 "DejaVu Serif", Georgia, serif; color: var(--ferne);
    text-align: left;
  }
  /* Mehr Bilder hintereinander werden eine Bildzeile. */
  .galerie { display: flex; gap: 4mm; align-items: flex-start; }
  .galerie figure { flex: 1; margin: 0; }

  blockquote {
    margin: 4mm 0 5mm; padding: 1mm 0 1mm 5mm; border-left: 2px solid var(--akzent);
    font-style: italic; font-size: 12pt; line-height: 1.55; color: var(--milde); break-inside: avoid;
  }
  blockquote p { text-align: left; }

  .kasten {
    background: var(--schatten); border: 1px solid var(--linie); border-left: 3px solid var(--akzent);
    padding: 4mm 5mm; margin: 4mm 0 5mm; break-inside: avoid; font-size: 10.5pt;
  }

  code { font-family: "DejaVu Sans Mono", monospace; font-size: 9pt; background: var(--schatten); border-radius: 2px; padding: 1px 3px; }
  pre { background: var(--schatten); border: 1px solid var(--linie); padding: 3mm 4mm; overflow-wrap: anywhere; break-inside: avoid; }
  pre code { background: none; padding: 0; }

  table { width: 100%; border-collapse: collapse; margin: 3mm 0 5mm; break-inside: avoid; font-size: 10pt; }
  th, td { border: none; border-bottom: 1px solid var(--linie); padding: 1.6mm 2mm; text-align: left; vertical-align: top; }
  th { border-bottom: 1.5px solid var(--tinte); font: 600 8.5pt/1.4 "DejaVu Sans", sans-serif; letter-spacing: .06em; text-transform: uppercase; }

  hr { border: none; border-top: 1px solid var(--linie); margin: 6mm 0; }
  .nachspann { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid var(--linie); font: 9pt/1.5 "DejaVu Sans", sans-serif; color: var(--ferne); }
`

// ------------------------------------------------------------- Gestaltung

/**
 * Wie ein Dokument aussieht — vom Modell wählbar und später änderbar
 * („das Design gefällt mir nicht“, „mach die Überschriften blau“).
 * Eine Vorlage setzt die Grundwerte, einzelne Angaben überschreiben sie.
 */
export interface Gestaltung {
  vorlage?: 'klassisch' | 'modern' | 'schlicht' | 'brief'
  /** Akzentfarbe, z. B. #1f5fa8 oder ein CSS-Farbname. */
  akzent?: string
  schrift?: 'serif' | 'sans'
  deckblatt?: boolean
  kapitelNeueSeite?: boolean
  seitenzahlen?: boolean
  /** Zusätzliche CSS-Regeln für Feinheiten (nur PDF). */
  css?: string
}

export type Aufgeloest = Required<Omit<Gestaltung, 'akzent' | 'css'>> & Pick<Gestaltung, 'akzent' | 'css'>

const VORLAGEN: Record<NonNullable<Gestaltung['vorlage']>, Omit<Aufgeloest, 'vorlage' | 'akzent' | 'css'>> = {
  // Das gesetzte Heft von bisher: Deckel, jedes Kapitel auf neuer Seite.
  klassisch: { schrift: 'serif', deckblatt: true, kapitelNeueSeite: true, seitenzahlen: true },
  // Bericht: serifenlos, kräftiger Deckel, Kapitel laufen durch.
  modern: { schrift: 'sans', deckblatt: true, kapitelNeueSeite: false, seitenzahlen: true },
  // Ein- oder mehrseitiges Papier ohne Deckel: Titel oben, dann der Text.
  schlicht: { schrift: 'sans', deckblatt: false, kapitelNeueSeite: false, seitenzahlen: true },
  // Anschreiben, Brief: kein Deckel, keine Titelzeile, keine Seitenzahl.
  brief: { schrift: 'sans', deckblatt: false, kapitelNeueSeite: false, seitenzahlen: false }
}

/** Vorlage plus Einzelangaben zu vollständigen Werten zusammenführen. */
export function gestaltungAufloesen(g: Gestaltung | undefined): Aufgeloest {
  // Vorgabe ist ein normales Papier; das Heft mit Deckel nur auf Wunsch.
  const vorlage = g?.vorlage && g.vorlage in VORLAGEN ? g.vorlage : 'schlicht'
  const basis = VORLAGEN[vorlage]
  return {
    vorlage,
    schrift: g?.schrift ?? basis.schrift,
    deckblatt: g?.deckblatt ?? basis.deckblatt,
    kapitelNeueSeite: g?.kapitelNeueSeite ?? basis.kapitelNeueSeite,
    seitenzahlen: g?.seitenzahlen ?? basis.seitenzahlen,
    akzent: gueltigeFarbe(g?.akzent),
    css: g?.css
  }
}

/** Nur echte Farbangaben durchlassen — die Angabe landet in einem Stylesheet. */
export function gueltigeFarbe(farbe: string | undefined): string | undefined {
  const f = farbe?.trim()
  if (!f) return undefined
  return /^#[0-9a-f]{3,8}$/i.test(f) || /^[a-z]{3,20}$/i.test(f) || /^(rgb|hsl)a?\([\d\s.,%]+\)$/i.test(f) ? f : undefined
}

/** Die Regeln, die eine Gestaltung über die Grundvorlage legt. */
function gestaltungsCss(g: Aufgeloest): string {
  const regeln: string[] = []
  if (g.akzent) regeln.push(`:root { --akzent: ${g.akzent}; }`)
  if (g.schrift === 'sans') {
    regeln.push(`
  body { font-family: "DejaVu Sans", "Liberation Sans", Arial, sans-serif; font-size: 10.5pt; line-height: 1.6; font-variant-numeric: normal; }
  p { text-align: left; hyphens: manual; }
  figcaption, blockquote { font-family: inherit; }`)
  }
  if (g.vorlage !== 'klassisch') {
    regeln.push('.kapitel > p:first-of-type::first-letter { float: none; font-size: inherit; line-height: inherit; padding: 0; color: inherit; }')
  }
  if (!g.kapitelNeueSeite) regeln.push('.kapitel + .kapitel { break-before: auto; } .kapitel { margin-top: 9mm; }')
  if (g.vorlage === 'modern') {
    regeln.push(`
  .deckel { padding-top: 0; }
  .deckel__horn { margin-top: 0; padding: 26mm 0 6mm; border-top: 10mm solid var(--akzent); }
  .deckel h1 { font-size: 36pt; font-weight: 700; color: var(--akzent); }
  .deckel__steg { border-top: none; padding-top: 0; font-style: normal; }
  h2 { color: var(--akzent); }
  .kapitel > h1, .kapitel > h2 { border-bottom: none; padding-bottom: 0; }`)
  }
  if (g.vorlage === 'schlicht') {
    regeln.push(`
  .dokumenttitel { font-size: 21pt; margin: 0 0 2mm; }
  .dokumentsteg { margin: 0 0 8mm; color: var(--milde); }
  .kapitel > h1, .kapitel > h2 { border-bottom: 1px solid var(--linie); }`)
  }
  if (g.vorlage === 'brief') {
    regeln.push(`
  body { font-size: 11pt; line-height: 1.5; }
  p { margin: 0 0 1em; }
  h1, h2 { font-size: 12pt; margin: 6mm 0 3mm; }
  .kapitel { margin-top: 0; }
  .kapitel > h1, .kapitel > h2 { border-bottom: none; padding-bottom: 0; }`)
  }
  // Eigenes CSS zuletzt, damit es gewinnt — aber es darf den Style-Block nicht verlassen.
  if (g.css?.trim()) regeln.push(g.css.replace(/</g, ''))
  return regeln.join('\n')
}

/** Ein Bild, wenn möglich mit eingebettetem Bildpunkt. */
function imageHtml(block: { src: string; label?: string }, einbetten?: (src: string) => string | null): string {
  // null: nicht gefunden — das Bild bleibt als Platzhalter stehen. Leerer Text:
  // bewusst gesperrt (Netzbild, keine Bilddatei) — dann nur die Bildunterschrift.
  const eingebettet = einbetten?.(block.src)
  if (eingebettet === '') return block.label ? `<p class="bild-fehlt">[${escapeHtml(block.label)}]</p>` : ''
  const quelle = eingebettet ?? block.src
  const figuer = `<figure><img src="${escapeHtml(quelle)}" alt="${escapeHtml(block.label ?? '')}">${
    block.label ? `<figcaption>${escapeHtml(block.label)}</figcaption>` : ''
  }</figure>`
  return figuer
}

/** Reichen mehrere Bilder hintereinander, werden sie eine Zeile. */
function galerie(liste: string[]): string {
  if (liste.length < 2) return liste.join('')
  return `<div class="galerie">${liste.join('')}</div>`
}

/**
 * Der reine Text einer Zeile — zum Vergleichen mit dem Titel. inlineHtml wäre
 * falsch: „Tom & Jerry“ steht dort als „Tom &amp; Jerry“, der Deckeltitel kam
 * doppelt, und die Kapiteltiefe verrutschte.
 */
function klartext(inline: Inline[]): string {
  return inline.map((teil) => teil.text).join('').trim()
}

/** Vollständiges HTML-Dokument für die PDF-Ausgabe. */
/**
 * Vollständiges HTML-Dokument für die PDF-Ausgabe: ein Deckel, dann Kapitel.
 *
 * Die erste Überschrift darf der Deckeltitel sein — sonst stünde er zweimal.
 * Das erste Bild wird zum Titelbild, Bilder hintereinander werden eine Zeile.
 */
export function renderHtmlDocument(
  title: string,
  blocks: Block[],
  opts?: { untertitel?: string; zeile?: string; einbetten?: (src: string) => string | null; gestaltung?: Gestaltung }
): string {
  const einbetten = opts?.einbetten
  const gestaltung = gestaltungAufloesen(opts?.gestaltung)
  const kapitel: Array<{ titel: string; stuecke: string[] }> = [{ titel: '', stuecke: [] }]
  let titelbild = ''

  /* Die Kapiteltiefe wird mitgelesen: wer mit "# Buchtitel" aufmacht, zählt
     "## Kapitel 1" — wer ohne Deckelüberschrift schreibt, zählt schon "#". */
  const erste = blocks.find((block) => block.type === 'heading')
  const deckelueberschrift =
    erste?.type === 'heading' && erste.level === 1 && klartext(erste.inline) === title.trim()
  const kapitelStufe = deckelueberschrift ? 2 : 1
  const kapitelEbene = deckelueberschrift ? 2 : 1

  const anhaengen = (html: string): void => {
    kapitel[kapitel.length - 1]!.stuecke.push(html)
  }
  let wartend: Array<Extract<Block, { type: 'image' }>> = []
  const spülen = (): void => {
    if (wartend.length === 0) return
    const zeile = galerie(wartend.map((bild) => imageHtml(bild, einbetten)))
    wartend = []
    if (!titelbild && !kapitel.some((kapitel_) => kapitel_.titel !== '')) titelbild = zeile
    else anhaengen(zeile)
  }

  for (const block of blocks) {
    if (block.type === 'image') {
      wartend.push(block)
      continue
    }
    spülen()
    // Die Deckelüberschrift wird nicht wiederholt — sie steht oben auf dem Deckel.
    if (deckelueberschrift && block === erste) continue
    // Die Signaturzeile ebenfalls nicht: sie steht schon unter dem Titel.
    if (
      opts?.untertitel &&
      block.type === 'paragraph' &&
      klartext(block.inline).replace(/[.!]$/, '') === opts.untertitel.trim().replace(/[.!]$/, '')
    ) {
      continue
    }
    if (block.type === 'heading' && block.level === kapitelStufe) {
      kapitel.push({ titel: inlineHtml(block.inline), stuecke: [] })
      continue
    }
    anhaengen(blockHtml(block, einbetten))
  }
  spülen()

  // Einleitung ohne Überschrift bleibt vor dem ersten Kapitel stehen.
  const vorwort = kapitel.shift()!
  const datum = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date())
  const deckel = `<section class="deckel">
<div class="deckel__horn">${herdschaleSvg(15, 'currentColor', 2)}${escapeHtml(opts?.zeile ?? 'Hestia')}</div>
<h1>${escapeHtml(title)}</h1>
${opts?.untertitel ? `<p class="deckel__steg">${escapeHtml(opts.untertitel)}</p>` : ''}
${titelbild ? `<div class="deckel__bild">${titelbild}</div>` : ''}
<div class="deckel__fuss"><span>${escapeHtml(opts?.zeile ?? 'Hestia')}</span><span>${escapeHtml(datum)}</span></div>
</section>`

  // Ohne Deckel steht der Titel oben auf der ersten Seite — im Brief gar nicht:
  // dort beginnt die Seite mit dem, was die Vorlage selbst mitbringt.
  const kopf = gestaltung.deckblatt
    ? deckel
    : gestaltung.vorlage === 'brief'
      ? titelbild
      : `<h1 class="dokumenttitel">${escapeHtml(title)}</h1>${opts?.untertitel ? `<p class="dokumentsteg">${escapeHtml(opts.untertitel)}</p>` : ''}${titelbild}`

  const rumpf = [
    kopf,
    ...vorwort.stuecke,
    ...kapitel.map(
      (kapitel_) =>
        `<section class="kapitel"><h${kapitelEbene}>${kapitel_.titel}</h${kapitelEbene}>${kapitel_.stuecke.join('\n')}</section>`
    )
  ].join('\n')

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${PRINT_CSS}
${gestaltungsCss(gestaltung)}</style>
</head>
<body>${rumpf}</body>
</html>`
}

/** Ein Block zu HTML — die alten Stücke, jetzt mit Bild. */
function blockHtml(block: Block, einbetten?: (src: string) => string | null): string {
  switch (block.type) {
    case 'heading': {
      const level = Math.min(block.level, 6)
      return `<h${level}>${inlineHtml(block.inline)}</h${level}>`
    }
    case 'paragraph':
      return `<p>${inlineHtml(block.inline)}</p>`
    case 'bullets':
      return `<ul>${block.items
        .map((item) => (/^[☐☑]/.test(item[0]?.text ?? '') ? `<li class="aufgabe">${inlineHtml(item)}</li>` : `<li>${inlineHtml(item)}</li>`))
        .join('')}</ul>`
    case 'numbered':
      return `<ol>${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join('')}</ol>`
    case 'quote':
      return `<blockquote><p>${inlineHtml(block.inline)}</p></blockquote>`
    case 'code':
      return `<pre><code>${escapeHtml(block.text)}</code></pre>`
    case 'table':
      return renderTable(block.rows)
    case 'rule':
      return '<hr>'
    case 'image':
      return imageHtml(block, einbetten)
  }
}

function renderTable(rows: Inline[][][]): string {
  if (rows.length === 0) return ''
  const cells = (row: Inline[][], tag: string): string =>
    `<tr>${row.map((cell) => `<${tag}>${inlineHtml(cell)}</${tag}>`).join('')}</tr>`
  const [head, ...rest] = rows
  return `<table>${cells(head!, 'th')}${rest.map((row) => cells(row, 'td')).join('')}</table>`
}
