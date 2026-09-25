/**
 * Dokumente, an denen man weiterarbeiten kann.
 *
 * Bisher war ein erzeugtes PDF eine Einbahnstraße: „ergänze noch eine Zeile“
 * oder „das Design gefällt mir nicht“ führten zu einem komplett neu
 * geschriebenen Dokument, im schlimmsten Fall mit anderem Inhalt. Jetzt merkt
 * sich Hestia zu jedem Dokument die Quelle (Markdown, Titel, Gestaltung) und
 * jede frühere Fassung, und das Modell bekommt drei Werkzeuge:
 *
 * - `dokument_lesen` — was steht drin, wie sieht es aus;
 * - `dokument_bearbeiten` — gezielte Ersetzungen („alt“ → „neu“), Anhängen,
 *   neue Gestaltung; die Datei wird an derselben Stelle neu gesetzt, die
 *   offene Vorschau zieht nach;
 * - `dokument_wiederherstellen` — „mach das rückgängig“.
 *
 * Auch Dateien, die Hestia nicht selbst erzeugt hat (im Agent-Ordner),
 * lassen sich lesen und übernehmen — dann aus ihrem Text neu gesetzt.
 */
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import type { Chat } from '@shared/types'
import type { ToolSpec } from './providers/types'
import type { ToolRuntime } from './chat'
import type { GespeichertesDokument, Store } from './db'
import { createDocument, type DocKind } from './documents/create'
import type { Gestaltung } from './documents/markdown'
import { documentsDir, freierPfad, registerFile } from './documents/registry'
import { createSandbox } from './agent/sandbox'
import { GESTALTUNG_SCHEMA, dokumentAngaben, gestaltungAus, type AsksPermission } from './agent/tools'
import { textAusDatei } from './kontext'

const ART_NAME: Record<DocKind, string> = { markdown: 'Markdown', docx: 'Word', pdf: 'PDF' }
const ART_NACH_ENDUNG: Record<string, DocKind> = { '.md': 'markdown', '.markdown': 'markdown', '.txt': 'markdown', '.docx': 'docx', '.pdf': 'pdf' }

/** So viel Quelltext gibt dokument_lesen auf einmal zurück. */
const LESEN_HOECHSTENS = 60_000

export interface DokumentKontext {
  store: Store
  chat: Chat
  /** Arbeitsordner (Agent); leer im normalen Chat. */
  folder: string
  autoApproveWrites: boolean
  permissions: AsksPermission
  /** Für diesen Pfad wurde in diesem Schritt schon gefragt (fremde Datei übernommen). */
  bereitsErlaubt?: string
}

/** Das Original einer fremden Datei sichern, bevor Hestia es neu setzt. */
async function sichereOriginal(pfad: string): Promise<string> {
  const ordner = join(documentsDir(), 'Sicherungen')
  await mkdir(ordner, { recursive: true })
  const endung = extname(pfad)
  const ziel = freierPfad(join(ordner, `${basename(pfad, endung)} (Original)${endung}`))
  await copyFile(pfad, ziel)
  return ziel
}

type Ergebnis = { ok: boolean; output: string; document?: import('@shared/types').DocumentRef }

function kurz(d: GespeichertesDokument): string {
  const vorlage = d.art !== 'markdown' && d.gestaltung?.vorlage ? `, Vorlage ${d.gestaltung.vorlage}` : ''
  return `„${d.titel}“ → Datei ${basename(d.pfad)} (${ART_NAME[d.art]}, Fassung ${d.version}${vorlage})`
}

/** Die Dokumente dieses Chats (und seines Projekts) für den Systemprompt. */
export function dokumentTeile(store: Store, chat: Chat, mitWerkzeugen: boolean): string[] {
  const liste = store.dokumenteFuer(chat.id, chat.projectId, 20)
  if (liste.length === 0) return []
  const zeilen = liste.map((d) => `- ${kurz(d)}`).join('\n')
  const regeln = mitWerkzeugen
    ? 'Soll an einem dieser Dokumente etwas geändert werden — eine Zeile ergänzen, einen Absatz umschreiben, ' +
      'das Design ändern, einen Fehler korrigieren —, dann bearbeite genau dieses Dokument mit dokument_bearbeiten, ' +
      'statt mit create_document ein neues zu schreiben. Lies vorher mit dokument_lesen, was drinsteht, und ersetze gezielt ' +
      '(alt → neu, wörtlich aus der Quelle kopiert). Alles, was nicht geändert werden soll, bleibt unangetastet. ' +
      '„Mach das rückgängig“ → dokument_wiederherstellen. Eine andere Fassung (z. B. zusätzlich als Word) → create_document mit dem gelesenen Inhalt.'
    : ''
  return [`Dokumente in diesem ${chat.projectId ? 'Projekt' : 'Chat'}:\n${zeilen}${regeln ? `\n\n${regeln}` : ''}`]
}

// ------------------------------------------------------------------ Werkzeuge

const SPEZ_LESEN: ToolSpec = {
  name: 'dokument_lesen',
  description: 'Liest ein Dokument aus diesem Chat (oder eine Datei im Arbeitsordner): Markdown-Quelle, Gestaltung, Fassung. Vor jeder Änderung aufrufen.',
  parameters: {
    type: 'object',
    properties: { dokument: { type: 'string', description: 'Dateiname oder Titel aus der Liste im Systemprompt, oder ein Pfad im Arbeitsordner' } },
    required: ['dokument'],
    additionalProperties: false
  }
}

const SPEZ_BEARBEITEN: ToolSpec = {
  name: 'dokument_bearbeiten',
  description:
    'Ändert ein bestehendes Dokument und setzt die Datei an derselben Stelle neu. Gezielt: aenderungen ersetzt jeweils eine Stelle ' +
    '(alt muss wörtlich und genau einmal in der Quelle stehen); anhaengen hängt Text ans Ende. Das Design ändert gestaltung ' +
    '(nur die genannten Angaben, der Rest bleibt). inhalt ersetzt die ganze Quelle — nur, wenn fast alles neu ist.',
  parameters: {
    type: 'object',
    properties: {
      dokument: { type: 'string', description: 'Dateiname oder Titel aus der Liste im Systemprompt' },
      aenderungen: {
        type: 'array',
        description: 'Ersetzungen in der Markdown-Quelle, der Reihe nach',
        items: {
          type: 'object',
          properties: {
            alt: { type: 'string', description: 'Die Stelle, wörtlich aus der Quelle (genug Kontext, damit sie eindeutig ist)' },
            neu: { type: 'string', description: 'Der neue Text an ihrer Stelle (leer = löschen)' }
          },
          required: ['alt', 'neu'],
          additionalProperties: false
        }
      },
      anhaengen: { type: 'string', description: 'Markdown, das ans Ende kommt' },
      inhalt: { type: 'string', description: 'Die komplette neue Markdown-Quelle (statt Einzeländerungen)' },
      gestaltung: GESTALTUNG_SCHEMA,
      titel: { type: 'string', description: 'Neuer Titel (Deckel, Kopfzeile)' },
      untertitel: { type: 'string', description: 'Neue Zeile unter dem Titel (nur PDF)' }
    },
    required: ['dokument'],
    additionalProperties: false
  }
}

const SPEZ_WIEDERHERSTELLEN: ToolSpec = {
  name: 'dokument_wiederherstellen',
  description: 'Setzt ein Dokument auf eine frühere Fassung zurück („mach das rückgängig“). Ohne fassung: die vorige.',
  parameters: {
    type: 'object',
    properties: {
      dokument: { type: 'string', description: 'Dateiname oder Titel aus der Liste im Systemprompt' },
      fassung: { type: 'number', description: 'Welche Fassung (Nummer aus dokument_lesen); ohne Angabe die vorige' }
    },
    required: ['dokument'],
    additionalProperties: false
  }
}

type Gefunden = { dok: GespeichertesDokument } | { extern: string } | { fehler: string }

function text(wert: unknown): string {
  return typeof wert === 'string' ? wert : ''
}

/** Ein Dokument über Dateiname, Titel oder Pfad finden — erst die eigenen, dann der Arbeitsordner. */
async function finde(ctx: DokumentKontext, name: string): Promise<Gefunden> {
  const gesucht = name.trim()
  if (!gesucht) return { fehler: 'Kein Dokument angegeben.' }
  const klein = gesucht.toLowerCase()
  const liste = ctx.store.dokumenteFuer(ctx.chat.id, ctx.chat.projectId, 100)
  const treffer =
    liste.find((d) => d.pfad === gesucht) ??
    liste.find((d) => basename(d.pfad).toLowerCase() === klein) ??
    liste.find((d) => d.titel.toLowerCase() === klein) ??
    liste.find((d) => d.pfad.toLowerCase().endsWith(klein)) ??
    liste.find((d) => basename(d.pfad).toLowerCase().includes(klein) || d.titel.toLowerCase().includes(klein))
  if (treffer) return { dok: treffer }

  if (ctx.folder) {
    try {
      const sandbox = await createSandbox(ctx.folder)
      const pfad = await sandbox.resolve(gesucht)
      const info = await stat(pfad).catch(() => undefined)
      if (info?.isFile()) {
        // Vielleicht hat Hestia genau diese Datei früher erzeugt — dann mit Quelle.
        const bekannt = ctx.store.dokumentNachPfad(pfad)
        return bekannt ? { dok: bekannt } : { extern: pfad }
      }
    } catch (e) {
      return { fehler: (e as Error).message }
    }
  }
  const namen = liste.map((d) => basename(d.pfad)).join(', ')
  return { fehler: `Kein Dokument „${gesucht}“ gefunden.${namen ? ` Vorhanden: ${namen}` : ''}` }
}

/** Eine fremde Datei übernehmen: ihr Text wird zur Quelle. */
async function uebernehmen(ctx: DokumentKontext, pfad: string): Promise<GespeichertesDokument | string> {
  const endung = extname(pfad).toLowerCase()
  const art = ART_NACH_ENDUNG[endung]
  if (!art) return `„${basename(pfad)}“: Nur Markdown, Text, Word und PDF lassen sich bearbeiten.`
  const daten = await readFile(pfad)
  const quelle = art === 'markdown' ? daten.toString('utf8') : (await textAusDatei(basename(pfad), daten)).text
  return ctx.store.speichereDokument({
    chatId: ctx.chat.id,
    projectId: ctx.chat.projectId,
    pfad,
    art,
    titel: basename(pfad, endung),
    markdown: quelle
  })
}

async function darfSchreiben(ctx: DokumentKontext, pfad: string, detail: string): Promise<boolean> {
  if (ctx.autoApproveWrites) return true
  return ctx.permissions.ask({
    chatId: ctx.chat.id,
    kind: 'write',
    target: ctx.folder ? relative(ctx.folder, pfad) || pfad : pfad,
    detail,
    rememberKey: `write:${pfad}`
  })
}

/** Neu setzen und als neue Fassung merken. */
async function setzen(
  ctx: DokumentKontext,
  dok: GespeichertesDokument,
  neu: { markdown: string; titel: string; untertitel?: string; gestaltung?: Gestaltung }
): Promise<{ dok: GespeichertesDokument; bytes: number }> {
  const erzeugt = await createDocument({ kind: dok.art, path: dok.pfad, markdown: neu.markdown, title: neu.titel, untertitel: neu.untertitel, gestaltung: neu.gestaltung })
  registerFile(erzeugt.path)
  const gespeichert = ctx.store.aktualisiereDokument(dok.id, { ...neu, chatId: dok.chatId ?? ctx.chat.id })!
  return { dok: gespeichert, bytes: erzeugt.bytes }
}

function ref(dok: GespeichertesDokument, bytes: number): Ergebnis['document'] {
  return { path: dok.pfad, kind: dok.art, title: dok.titel, bytes }
}

async function lesen(ctx: DokumentKontext, args: Record<string, unknown>): Promise<Ergebnis> {
  const gefunden = await finde(ctx, text(args.dokument))
  if ('fehler' in gefunden) return { ok: false, output: gefunden.fehler }
  if ('extern' in gefunden) {
    const endung = extname(gefunden.extern).toLowerCase()
    const daten = await readFile(gefunden.extern)
    const inhalt = ART_NACH_ENDUNG[endung] === 'markdown' ? daten.toString('utf8') : (await textAusDatei(basename(gefunden.extern), daten)).text
    return {
      ok: true,
      output:
        `# ${basename(gefunden.extern)}\n(Diese Datei hat Hestia nicht selbst erzeugt. dokument_bearbeiten übernimmt ihren Text als Quelle ` +
        `${ART_NACH_ENDUNG[endung] === 'markdown' ? '' : 'und setzt sie im Hestia-Satz neu — das ursprüngliche Layout geht dabei verloren'}.)\n\n` +
        abschneiden(inhalt)
    }
  }
  const d = gefunden.dok
  const frueher = ctx.store.dokumentVersionen(d.id)
  return {
    ok: true,
    output:
      `# ${d.titel}\nDatei: ${d.pfad}\nFormat: ${ART_NAME[d.art]} · Fassung ${d.version}${frueher.length ? ` (frühere: ${frueher.join(', ')})` : ''}\n` +
      (d.untertitel ? `Untertitel: ${d.untertitel}\n` : '') +
      (d.art !== 'markdown' ? `Gestaltung: ${JSON.stringify(d.gestaltung ?? { vorlage: 'schlicht' })}\n` : '') +
      `\n--- Markdown-Quelle ---\n${abschneiden(d.markdown)}`
  }
}

function abschneiden(inhalt: string): string {
  return inhalt.length > LESEN_HOECHSTENS ? `${inhalt.slice(0, LESEN_HOECHSTENS)}\n\n(… gekürzt: ${inhalt.length} Zeichen insgesamt)` : inhalt
}

/** Einzeländerungen auf die Quelle anwenden — jede Stelle muss eindeutig sein. */
export function wendeAn(quelle: string, aenderungen: { alt: string; neu: string }[]): { text: string } | { fehler: string } {
  let text = quelle
  for (const [i, { alt, neu }] of aenderungen.entries()) {
    if (!alt.trim()) return { fehler: `Änderung ${i + 1}: „alt“ ist leer. Zum Anfügen am Ende „anhaengen“ nutzen.` }
    let stelle = text.indexOf(alt)
    let laenge = alt.length
    if (stelle < 0) {
      // Häufigster Grund: Leerraum anders als in der Quelle (Zeilenumbruch, doppeltes Leerzeichen).
      const muster = new RegExp(alt.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g')
      const treffer = [...text.matchAll(muster)]
      if (treffer.length === 0) return { fehler: `Änderung ${i + 1}: Die Stelle „${alt.slice(0, 120)}“ steht nicht in der Quelle. Mit dokument_lesen nachsehen und wörtlich kopieren.` }
      // Auch hier gilt: nur eine eindeutige Stelle wird geändert.
      if (treffer.length > 1) return { fehler: `Änderung ${i + 1}: „${alt.slice(0, 120)}“ kommt mehrfach vor. Mehr umgebenden Text angeben, damit die Stelle eindeutig ist.` }
      const m = treffer[0]!
      stelle = m.index
      laenge = m[0].length
    } else if (text.indexOf(alt, stelle + 1) >= 0) {
      return { fehler: `Änderung ${i + 1}: „${alt.slice(0, 120)}“ kommt mehrfach vor. Mehr umgebenden Text angeben, damit die Stelle eindeutig ist.` }
    }
    text = text.slice(0, stelle) + neu + text.slice(stelle + laenge)
  }
  return { text }
}

async function bearbeiten(ctx: DokumentKontext, args: Record<string, unknown>): Promise<Ergebnis> {
  const gefunden = await finde(ctx, text(args.dokument))
  if ('fehler' in gefunden) return { ok: false, output: gefunden.fehler }
  let dok: GespeichertesDokument
  let hinweis = ''
  if ('extern' in gefunden) {
    // Erst fragen, dann übernehmen: Eine fremde PDF oder Word-Datei wird aus
    // ihrem Text neu gesetzt — ihr Layout ist danach weg. Das Original wandert
    // vorher in eine Sicherung, damit es nicht verloren ist.
    const endung = extname(gefunden.extern).toLowerCase()
    const neuGesetzt = ART_NACH_ENDUNG[endung] !== 'markdown'
    if (!(await darfSchreiben(ctx, gefunden.extern, `Dokument ändern: ${basename(gefunden.extern)}${neuGesetzt ? ' — wird aus seinem Text neu gesetzt, das bisherige Layout geht verloren (Original wird gesichert)' : ''}`))) {
      return { ok: false, output: 'Vom Benutzer abgelehnt.' }
    }
    const uebernommen = await uebernehmen(ctx, gefunden.extern)
    if (typeof uebernommen === 'string') return { ok: false, output: uebernommen }
    dok = uebernommen
    if (neuGesetzt) {
      const sicherung = await sichereOriginal(gefunden.extern)
      hinweis = ` Die Datei wurde aus ihrem Text neu gesetzt; das ursprüngliche Layout ist nicht erhalten. Das Original liegt unter ${sicherung}.`
    }
    ctx.bereitsErlaubt = gefunden.extern
  } else {
    dok = gefunden.dok
  }

  const aenderungen = Array.isArray(args.aenderungen)
    ? (args.aenderungen as unknown[]).filter((a): a is { alt: string; neu: string } => !!a && typeof a === 'object' && typeof (a as { alt?: unknown }).alt === 'string').map((a) => ({ alt: a.alt, neu: text(a.neu) }))
    : []
  const inhalt = text(args.inhalt)
  const anhaengen = text(args.anhaengen)
  const neueGestaltung = gestaltungAus(args.gestaltung)
  const titel = text(args.titel).trim()
  const untertitel = typeof args.untertitel === 'string' ? args.untertitel.trim() : undefined
  if (!inhalt.trim() && aenderungen.length === 0 && !anhaengen.trim() && !neueGestaltung && !titel && untertitel === undefined) {
    return { ok: false, output: 'Nichts zu ändern angegeben (aenderungen, anhaengen, inhalt, gestaltung, titel oder untertitel).' }
  }

  let markdown = inhalt.trim() ? inhalt : dok.markdown
  if (!inhalt.trim() && aenderungen.length) {
    const ergebnis = wendeAn(markdown, aenderungen)
    if ('fehler' in ergebnis) return { ok: false, output: ergebnis.fehler }
    markdown = ergebnis.text
  }
  if (anhaengen.trim()) markdown = `${markdown.replace(/\s+$/, '')}\n\n${anhaengen.trim()}\n`

  // Nur die genannten Angaben ändern sich; ein leeres css nimmt das eigene CSS zurück.
  const gestaltung: Gestaltung | undefined = neueGestaltung ? { ...dok.gestaltung, ...neueGestaltung } : dok.gestaltung
  if (gestaltung && typeof (args.gestaltung as { css?: unknown } | undefined)?.css === 'string' && !(args.gestaltung as { css: string }).css.trim()) delete gestaltung.css

  const was = [
    aenderungen.length ? `${aenderungen.length} Änderung${aenderungen.length === 1 ? '' : 'en'}` : '',
    inhalt.trim() ? 'Inhalt neu' : '',
    anhaengen.trim() ? 'Text angefügt' : '',
    neueGestaltung ? `Gestaltung ${JSON.stringify(neueGestaltung)}` : '',
    titel ? `Titel „${titel}“` : ''
  ].filter(Boolean).join(', ')
  if (ctx.bereitsErlaubt !== dok.pfad && !(await darfSchreiben(ctx, dok.pfad, `Dokument ändern: ${dok.titel} (${was})`))) return { ok: false, output: 'Vom Benutzer abgelehnt.' }
  ctx.bereitsErlaubt = undefined

  const { dok: neu, bytes } = await setzen(ctx, dok, { markdown, titel: titel || dok.titel, untertitel: untertitel === undefined ? dok.untertitel : untertitel || undefined, gestaltung })
  const nurMarkdown = neueGestaltung && dok.art === 'markdown' ? ' (Eine Markdown-Datei hat keine Gestaltung — die Angabe wirkt erst in PDF oder Word.)' : ''
  return { ok: true, output: `${basename(neu.pfad)} aktualisiert → Fassung ${neu.version}: ${was}.${hinweis}${nurMarkdown}`, document: ref(neu, bytes) }
}

async function wiederherstellen(ctx: DokumentKontext, args: Record<string, unknown>): Promise<Ergebnis> {
  const gefunden = await finde(ctx, text(args.dokument))
  if ('fehler' in gefunden) return { ok: false, output: gefunden.fehler }
  if ('extern' in gefunden) return { ok: false, output: 'Zu dieser Datei gibt es keine früheren Fassungen in Hestia.' }
  const dok = gefunden.dok
  const ziel = typeof args.fassung === 'number' && Number.isFinite(args.fassung) ? Math.floor(args.fassung) : dok.version - 1
  const alt = ctx.store.dokumentVersion(dok.id, ziel)
  if (!alt) {
    const vorhanden = ctx.store.dokumentVersionen(dok.id)
    return { ok: false, output: vorhanden.length ? `Keine Fassung ${ziel}. Vorhanden: ${vorhanden.join(', ')} (aktuell ${dok.version}).` : 'Es gibt noch keine frühere Fassung.' }
  }
  if (!(await darfSchreiben(ctx, dok.pfad, `Dokument zurücksetzen: ${dok.titel} auf Fassung ${ziel}`))) return { ok: false, output: 'Vom Benutzer abgelehnt.' }
  // Auch das Zurücksetzen ist eine neue Fassung — so lässt es sich selbst wieder zurücknehmen.
  const { dok: neu, bytes } = await setzen(ctx, dok, alt)
  return { ok: true, output: `${basename(neu.pfad)} auf den Stand von Fassung ${ziel} zurückgesetzt (jetzt Fassung ${neu.version}).`, document: ref(neu, bytes) }
}

/**
 * Legt die Dokumentwerkzeuge um einen Werkzeugkasten und merkt sich, was
 * create_document erzeugt. Ohne Kasten, der Dokumente erzeugen kann, bleibt
 * er unverändert.
 */
export function mitDokumenten(runtime: ToolRuntime | undefined, ctx: DokumentKontext): ToolRuntime | undefined {
  if (!runtime?.specs.some((spec) => spec.name === 'create_document')) return runtime
  const eigene: Record<string, (args: Record<string, unknown>) => Promise<Ergebnis>> = {
    [SPEZ_LESEN.name]: (args) => lesen(ctx, args),
    [SPEZ_BEARBEITEN.name]: (args) => bearbeiten(ctx, args),
    [SPEZ_WIEDERHERSTELLEN.name]: (args) => wiederherstellen(ctx, args)
  }
  return {
    specs: [...runtime.specs, SPEZ_LESEN, SPEZ_BEARBEITEN, SPEZ_WIEDERHERSTELLEN],
    // Lesen und Ändern kosten je einen Schritt mehr als bisher das bloße Erzeugen.
    maxSteps: Math.max(runtime.maxSteps ?? 12, 12),
    async execute(callId, name, args) {
      const werkzeug = eigene[name]
      if (werkzeug) {
        try {
          return await werkzeug((args ?? {}) as Record<string, unknown>)
        } catch (e) {
          return { ok: false, output: (e as Error).message }
        }
      }
      // Gleichbedeutende Feldnamen (inhalt, titel …) schon hier vereinheitlichen,
      // damit auch die Registrierung die Quelle findet.
      const angaben = name === 'create_document' ? dokumentAngaben((args ?? {}) as Record<string, unknown>) : args
      const ergebnis = await runtime.execute(callId, name, angaben)
      if (name === 'create_document' && ergebnis.ok && ergebnis.document) {
        const a = angaben as Record<string, unknown>
        const dok = ctx.store.speichereDokument({
          chatId: ctx.chat.id,
          projectId: ctx.chat.projectId,
          pfad: ergebnis.document.path,
          art: ergebnis.document.kind as DocKind,
          titel: text(a.title).trim() || ergebnis.document.title || basename(ergebnis.document.path),
          untertitel: text(a.untertitel).trim() || undefined,
          markdown: text(a.content),
          gestaltung: gestaltungAus(a.gestaltung)
        })
        return { ...ergebnis, output: `${ergebnis.output} (Fassung ${dok.version}; später mit dokument_bearbeiten änderbar)` }
      }
      return ergebnis
    }
  }
}
