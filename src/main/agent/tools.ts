/**
 * Werkzeug-Katalog des Ordner-Agenten. Jede Ausführung läuft durch die Sandbox
 * und — soweit schreibend oder ausführend — durch den Berechtigungs-Broker.
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type { ToolRuntime } from '../chat'
import type { ToolSpec } from '../providers/types'
import { createSandbox, globMatches, LIMITS, truncate, type Sandbox } from './sandbox'
import { berichtGrundlage, recherchiere } from '../research'
import { leseSeite, privateIp, suchen } from '../research/web'
import { isIP } from 'node:net'
import { createDocument, type DocKind } from '../documents/create'
import type { Gestaltung } from '../documents/markdown'
import { documentsDir as defaultDocumentsDir, freierPfad, registerFile } from '../documents/registry'
import type { DocumentRef } from '@shared/types'
/** Nur die Rückfrage ist für Werkzeuge relevant — daher strukturell typisiert. */
export interface AsksPermission {
  ask(request: {
    chatId: string
    kind: 'write' | 'command'
    target: string
    detail: string
    rememberKey?: string
  }): Promise<boolean>
}
import { log } from '../logger'

const BINARY_HINTS = ['\u0000', '\u0001', '\u0002', '\u0003']

export interface AgentContext {
  chatId: string
  /** Arbeitsordner; leer, wenn nur Dokumente erzeugt werden sollen. */
  folder: string
  settings: {
    autoApproveWrites: boolean
    allowCommands: boolean
  }
  permissions: AsksPermission
  /** Fortschritt für die Oberfläche (Aufgabenliste des Laufs). */
  onProgress?: (items: { text: string; done: boolean }[]) => void
}

/**
 * Aussehen eines PDF- oder Word-Dokuments. Dieselbe Angabe nimmt
 * dokument_bearbeiten — so lässt sich das Design später ändern.
 */
export const GESTALTUNG_SCHEMA = {
  type: 'object',
  description:
    'Optional: Aussehen (PDF, teils Word). vorlage: schlicht (Vorgabe) = normales Dokument ohne Deckblatt, Titel oben; ' +
    'brief = für Anschreiben, Bewerbungen und Briefe, ohne Deckblatt, Titelzeile und Seitenzahl — dafür immer brief nehmen; ' +
    'modern = serifenlos mit farbigem Deckblatt, für Berichte; klassisch = gesetztes Buch/Heft mit Deckblatt und jedem Kapitel auf neuer Seite, nur wenn ausdrücklich ein Buch oder Heft gewünscht ist. ' +
    'Einzelangaben überschreiben die Vorlage.',
  properties: {
    vorlage: { type: 'string', enum: ['klassisch', 'modern', 'schlicht', 'brief'] },
    akzent: { type: 'string', description: 'Akzentfarbe als Hex, z. B. #1f5fa8' },
    schrift: { type: 'string', enum: ['serif', 'sans'] },
    deckblatt: { type: 'boolean' },
    kapitelNeueSeite: { type: 'boolean' },
    seitenzahlen: { type: 'boolean' },
    css: { type: 'string', description: 'Nur für Feinheiten, die die Angaben oben nicht abdecken: zusätzliche CSS-Regeln für das PDF' }
  },
  additionalProperties: false
} as const

const SPECS: ToolSpec[] = [
  {
    name: 'list_dir',
    description: 'Verzeichnisinhalt eines Ordners innerhalb des Arbeitsordners auflisten.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relativer Pfad, "" für die Wurzel' } },
      additionalProperties: false
    }
  },
  {
    name: 'read_file',
    description: 'Textdatei innerhalb des Arbeitsordners lesen.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, max_bytes: { type: 'number' } },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    name: 'search_files',
    description: 'Dateinamen (Glob) oder Textinhalte (regulärer Ausdruck) im Arbeitsordner suchen.',
    parameters: {
      type: 'object',
      properties: {
        glob: { type: 'string', description: 'z. B. **/*.ts' },
        pattern: { type: 'string', description: 'Suchtext oder regulärer Ausdruck' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'write_file',
    description: 'Datei im Arbeitsordner anlegen oder vollständig überschreiben.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
      additionalProperties: false
    }
  },
  {
    name: 'edit_file',
    description: 'Eine eindeutige Textstelle in einer Datei ersetzen (kleine, präzise Änderung).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_text: { type: 'string', description: 'Muss genau einmal vorkommen' },
        new_text: { type: 'string' }
      },
      required: ['path', 'old_text', 'new_text'],
      additionalProperties: false
    }
  },
  {
    name: 'run_command',
    description: 'Befehl im Arbeitsordner ausführen (ohne Shell-Metazeichen). Nur verfügbar, wenn Kommandos freigegeben sind.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Programm, z. B. "ls"' },
        args: { type: 'array', items: { type: 'string' }, description: 'Argumentliste' }
      },
      required: ['command'],
      additionalProperties: false
    }
  },
  {
    name: 'create_document',
    description:
      'Dokument als Datei erzeugen — Markdown (.md), Word (.docx) oder PDF. ' +
      'Inhalt in Markdown-Schreibweise (Überschriften, Listen, Tabellen, Codeblöcke) übergeben. ' +
      'Ein PDF wird gesetzt: Deckel mit Titel und Signaturzeile, jedes Kapitel auf neuer Seite, ' +
      'Fußzeile mit Seitenzahl. Bilder aus dem Arbeitsordner werden eingebunden mit ' +
      '![Legende](bild.png) — ein Bild allein auf der Zeile; mehrere hintereinander werden eine Bildzeile, ' +
      'das erste wird zum Titelbild des Deckels. Für ein Kinderbuch oder eine Festschrift also: ' +
      'Kapitelüberschriften mit #, Unterzeile mit `untertitel`, Bilder dazwischen.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Dateiname ohne Endung' },
        format: { type: 'string', enum: ['markdown', 'docx', 'pdf'] },
        content: { type: 'string', description: 'Vollständiger Inhalt in Markdown' },
        path: { type: 'string', description: 'Optional: relativer Zielpfad im Arbeitsordner' },
        untertitel: {
          type: 'string',
          description:
            'Optional, nur PDF: Zeile unter dem Deckeltitel. Nur setzen, wenn der Auftrag eine nennt oder sie sich klar daraus ergibt — sonst weglassen.'
        },
        gestaltung: GESTALTUNG_SCHEMA
      },
      required: ['title', 'format', 'content'],
      additionalProperties: false
    }
  },
  {
    name: 'websuche',
    description:
      'Schnelle Websuche für aktuelle Fakten, Nachrichten, Preise, Öffnungszeiten, Versionen — alles, was sich seit dem Training geändert haben kann. ' +
      'Liefert Treffer mit Titel, Adresse und Auszug; für mehr Inhalt eine Adresse mit webseite_lesen öffnen. Für ausführliche Berichte mit Quellen: recherche.',
    parameters: {
      type: 'object',
      properties: { anfrage: { type: 'string', description: 'Suchbegriffe, wie in eine Suchmaschine getippt' } },
      required: ['anfrage'],
      additionalProperties: false
    }
  },
  {
    name: 'webseite_lesen',
    description: 'Liest den Text einer Webseite (http/https) — eine Adresse aus websuche oder eine, die die Nutzer:in nennt.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Vollständige Adresse mit https://' } },
      required: ['url'],
      additionalProperties: false
    }
  },
  {
    name: 'recherche',
    description:
      'Tiefere Recherche im Web: mehrere Anfragen, mehrere gelesene Seiten, jede Notiz mit Nummer und Adresse. ' +
      'Für Fragen, die Belege brauchen oder mehrere Gegenden abdecken. ' +
      'Danach den Bericht aus den Notizen schreiben und das Quellenverzeichnis untersetzen; ' +
      'auf Wunsch mit create_document als gesetztes PDF ausgeben.',
    parameters: {
      type: 'object',
      properties: {
        frage: { type: 'string', description: 'Die Forschungsfrage in einem Satz' },
        seiten: { type: 'number', description: 'Wie viele Seiten höchstens gelesen werden (3-8)', minimum: 3, maximum: 8 }
      },
      required: ['frage'],
      additionalProperties: false
    }
  },
  {
    name: 'todo',
    description: 'Arbeitsplan anlegen oder aktualisieren (Liste von Teilschritten).',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { text: { type: 'string' }, done: { type: 'boolean' } },
            required: ['text', 'done'],
            additionalProperties: false
          }
        }
      },
      required: ['items'],
      additionalProperties: false
    }
  }
]

export function createAgentRuntime(context: AgentContext): ToolRuntime {
  return {
    specs: SPECS,
    maxSteps: 24,
    async execute(_callId, name, rawArgs): Promise<{ ok: boolean; output: string }> {
      const args = (rawArgs ?? {}) as Record<string, unknown>
      try {
        switch (name) {
          case 'list_dir':
            return { ok: true, output: await listDir(context, asString(args.path)) }
          case 'read_file':
            return { ok: true, output: await readFileTool(context, asString(args.path), asNumber(args.max_bytes)) }
          case 'search_files':
            return { ok: true, output: await searchFiles(context, asString(args.glob), asString(args.pattern)) }
          case 'write_file':
            return await writeFileTool(context, asString(args.path), String(args.content ?? ''))
          case 'edit_file':
            return await editFileTool(context, asString(args.path), String(args.old_text ?? ''), String(args.new_text ?? ''))
          case 'run_command':
            return await runCommand(context, asString(args.command), Array.isArray(args.args) ? args.args.map(String) : [])
          case 'create_document':
            return await createDocumentTool(context, args)
          case 'recherche':
            return await rechercheTool(context, args)
          case 'websuche':
            return await websucheTool(args)
          case 'webseite_lesen':
            return await seiteTool(args)
          case 'todo':
            context.onProgress?.(
              (Array.isArray(args.items) ? args.items : []).map((item) => ({
                text: String((item as { text?: unknown }).text ?? ''),
                done: Boolean((item as { done?: unknown }).done)
              }))
            )
            return { ok: true, output: 'Arbeitsplan übernommen.' }
          default:
            return { ok: false, output: `Unbekanntes Werkzeug: ${name}` }
        }
      } catch (e) {
        const err = e as Error
        return { ok: false, output: err.message }
      }
    }
  }
}

async function openSandbox(context: AgentContext): Promise<Sandbox> {
  return createSandbox(context.folder)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

async function listDir(context: AgentContext, path: string): Promise<string> {
  const sandbox = await openSandbox(context)
  const target = await sandbox.resolve(path === '' ? '.' : path)
  const entries = await readdir(target, { withFileTypes: true })
  const lines = entries
    .slice(0, LIMITS.maxListEntries)
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
  return lines.length > 0 ? lines.join('\n') : '(leer)'
}

async function readFileTool(context: AgentContext, path: string, maxBytes?: number): Promise<string> {
  if (!path) throw new Error('read_file braucht einen Pfad')
  const sandbox = await openSandbox(context)
  const target = await sandbox.resolve(path)
  const info = await stat(target)
  if (!info.isFile()) throw new Error('Keine Datei')
  const limit = Math.min(maxBytes ?? LIMITS.maxReadBytes, LIMITS.maxReadBytes)
  if (info.size > limit) throw new Error(`Datei ist größer als ${limit} Zeichen — bitte abschnittsweise lesen`)
  const content = await readFile(target, 'utf8')
  if (BINARY_HINTS.some((hint) => content.includes(hint))) throw new Error('Binärdatei wird nicht als Text zurückgegeben')
  return truncate(content)
}

async function searchFiles(context: AgentContext, glob?: string, pattern?: string): Promise<string> {
  const sandbox = await openSandbox(context)
  const root = sandbox.root
  const regex = pattern ? compileLoose(pattern) : undefined
  const matches: string[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (matches.length >= LIMITS.maxSearchResults || depth > 8) return
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (matches.length >= LIMITS.maxSearchResults) return
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      const rel = relative(root, full)
      if (glob && !globMatches(glob, rel)) continue
      if (!regex) {
        matches.push(rel)
        continue
      }
      const info = await stat(full).catch(() => undefined)
      if (!info || info.size > LIMITS.maxReadBytes) continue
      const content = await readFile(full, 'utf8').catch(() => '')
      if (BINARY_HINTS.some((hint) => content.includes(hint))) continue
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i]!)) {
          matches.push(`${rel}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`)
          if (matches.length >= LIMITS.maxSearchResults) break
        }
      }
    }
  }

  await walk(root, 0)
  return matches.length > 0 ? truncate(matches.join('\n')) : 'Nichts gefunden.'
}

function compileLoose(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  }
}


async function writeFileTool(context: AgentContext, path: string, content: string): Promise<{ ok: boolean; output: string }> {
  if (!path) return { ok: false, output: 'write_file braucht einen Pfad' }
  const sandbox = await openSandbox(context)
  const target = await sandbox.resolve(path)
  if (Buffer.byteLength(content, 'utf8') > LIMITS.maxWriteBytes) {
    return { ok: false, output: `Inhalt zu groß (max. ${LIMITS.maxWriteBytes} Bytes) — bitte in Teilen schreiben` }
  }
  const existed = await stat(target).then((i) => i.isFile()).catch(() => false)

  const allowed =
    context.settings.autoApproveWrites ||
    (await context.permissions.ask({
      chatId: context.chatId,
      kind: 'write',
      target: relative(sandbox.root, target) || target,
      detail: `${existed ? 'Überschreiben' : 'Anlegen'}: ${relative(sandbox.root, target)} (${content.length} Zeichen)`,
      rememberKey: `write:${target}`
    }))
  if (!allowed) return { ok: false, output: 'Vom Benutzer abgelehnt.' }

  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
  log.info('Agent hat geschrieben', target)
  return { ok: true, output: `${existed ? 'Überschrieben' : 'Angelegt'}: ${relative(sandbox.root, target)}` }
}

async function editFileTool(
  context: AgentContext,
  path: string,
  oldText: string,
  newText: string
): Promise<{ ok: boolean; output: string }> {
  if (!path || !oldText) return { ok: false, output: 'edit_file braucht Pfad und old_text' }
  const sandbox = await openSandbox(context)
  const target = await sandbox.resolve(path)
  const before = await readFile(target, 'utf8').catch(() => undefined)
  if (before === undefined) return { ok: false, output: 'Datei nicht gefunden' }
  const occurrences = before.split(oldText).length - 1
  if (occurrences === 0) return { ok: false, output: 'old_text wurde nicht gefunden — bitte exakte Stelle übergeben' }
  if (occurrences > 1) return { ok: false, output: `old_text kommt ${occurrences}× vor — bitte eindeutiger fassen` }

  const allowed =
    context.settings.autoApproveWrites ||
    (await context.permissions.ask({
      chatId: context.chatId,
      kind: 'write',
      target: relative(sandbox.root, target),
      detail: diffPreview(before, oldText, newText),
      rememberKey: `write:${target}`
    }))
  if (!allowed) return { ok: false, output: 'Vom Benutzer abgelehnt.' }

  await writeFile(target, before.replace(oldText, newText), 'utf8')
  return { ok: true, output: `Geändert: ${relative(sandbox.root, target)}` }
}

function diffPreview(before: string, oldText: string, newText: string): string {
  void before
  return `- ${oldText.split('\n').slice(0, 8).join('\n- ')}\n+ ${newText.split('\n').slice(0, 8).join('\n+ ')}`
}

async function runCommand(
  context: AgentContext,
  command: string,
  args: string[]
): Promise<{ ok: boolean; output: string }> {
  if (!command) return { ok: false, output: 'run_command braucht ein Programm' }
  if (!context.settings.allowCommands) {
    // Nur „ist zu" zu melden wäre eine Sackgasse — der Weg dorthin gehört dazu.
    return {
      ok: false,
      output: 'Kommandos sind deaktiviert — zu erlauben unter „Einstellungen → Ordner und Zugriffe".'
    }
  }
  if (/[;&|<>$`*]/.test(command) || args.some((a) => /[<>$`]/.test(a))) {
    return { ok: false, output: 'Shell-Metazeichen sind nicht erlaubt (kein Bedarf, kein Risiko).' }
  }

  const sandbox = await openSandbox(context)
  // `allowCommands` ist nur gesetzt, wenn die globale Erlaubnis besteht **und**
  // der Auftrag auf der obersten Stufe steht („Alle Genehmigungen
  // überspringen"). Dort verspricht die Oberfläche: nichts fragen. Auf jeder
  // anderen Stufe kommt dieser Weg gar nicht erst hierher.
  const allowed =
    context.settings.allowCommands
      ? true
      : await context.permissions.ask({
          chatId: context.chatId,
          kind: 'command',
          target: [command, ...args].join(' '),
          detail: `Ausführen in ${sandbox.root}`,
          rememberKey: `cmd:${command}`
        })
  if (!allowed) return { ok: false, output: 'Vom Benutzer abgelehnt.' }

  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd: sandbox.root, env: process.env, shell: false })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolvePromise({ ok: false, output: `${truncate(out)}\n(Zeitlimit erreicht)` })
    }, LIMITS.maxCommandMs)

    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolvePromise({ ok: false, output: e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ ok: code === 0, output: truncate([out, err].filter(Boolean).join('\n') || `(ohne Ausgabe, Code ${code})`) })
    })
  })
}

/* Die Tiefere Recherche: sammelt Funde, der Lauf schreibt den Bericht. */
async function websucheTool(args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
  const anfrage = String(args.anfrage ?? '').trim()
  if (!anfrage) return { ok: false, output: 'anfrage fehlt' }
  try {
    const treffer = await suchen(anfrage, { höchste: 8 })
    if (treffer.length === 0) return { ok: true, output: 'Keine Treffer. Andere Suchbegriffe versuchen.' }
    return { ok: true, output: treffer.map((t, i) => `[${i + 1}] ${t.titel}\n${t.url}\n${t.text}`).join('\n\n') }
  } catch (fehler) {
    return { ok: false, output: `Websuche fehlgeschlagen: ${fehler instanceof Error ? fehler.message : String(fehler)}` }
  }
}

/**
 * Nur öffentliche Adressen: Eine Seite im Netz, die das Modell liest, soll es
 * nicht dazu bringen können, Dienste auf diesem Rechner oder im Heimnetz
 * abzufragen (Ollama, Router, Fernzugang).
 */
export function oeffentlicheAdresse(url: string): URL | string {
  let adresse: URL
  try {
    adresse = new URL(url.trim())
  } catch {
    return 'Keine gültige Adresse (erwartet: https://…).'
  }
  if (adresse.protocol !== 'https:' && adresse.protocol !== 'http:') return 'Nur http- und https-Adressen.'
  const host = adresse.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const privat =
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') ||
    host === '0.0.0.0' || host === '::1' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
    /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)
  // IP direkt im Link (auch IPv6 mit verpackter IPv4): dieselbe Prüfung wie beim Abruf.
  const alsIp = isIP(host) ? privateIp(host) : false
  return privat || alsIp ? 'Adressen auf diesem Rechner oder im Heimnetz werden nicht gelesen.' : adresse
}

async function seiteTool(args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
  const adresse = oeffentlicheAdresse(String(args.url ?? ''))
  if (typeof adresse === 'string') return { ok: false, output: adresse }
  try {
    const text = await leseSeite(adresse.toString(), { zeichen: 14_000 })
    return { ok: true, output: `# ${adresse.toString()}\n\n${text}` }
  } catch (fehler) {
    return { ok: false, output: `Seite nicht lesbar: ${fehler instanceof Error ? fehler.message : String(fehler)}` }
  }
}

async function rechercheTool(context: AgentContext, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
  const frage = String(args.frage ?? '').trim()
  if (!frage) return { ok: false, output: 'frage fehlt — ohne Frage keine Recherche' }
  const seiten = Number(args.seiten ?? 6)
  try {
    const ergebnis = await recherchiere(frage, {
      seitenHöchstzahl: Number.isFinite(seiten) ? Math.min(8, Math.max(3, Math.round(seiten))) : 6,
      fortschritt: context.onProgress
    })
    return { ok: true, output: berichtGrundlage(ergebnis) }
  } catch (fehler) {
    return { ok: false, output: `Recherche abgebrochen: ${fehler instanceof Error ? fehler.message : String(fehler)}` }
  }
}

/** Gleichbedeutende Feldnamen, die lokale Modelle gern verwenden (oft auf Deutsch). */
const DOKUMENT_FELDER: Record<string, string[]> = {
  content: ['inhalt', 'text', 'markdown', 'body', 'inhalt_markdown', 'contents'],
  title: ['titel', 'name', 'dateiname', 'ueberschrift', 'überschrift'],
  untertitel: ['subtitle', 'unternitel', 'untertiel', 'unter_titel'],
  format: ['dateiformat', 'typ', 'art', 'type'],
  gestaltung: ['design', 'layout', 'stil', 'style']
}
const GESTALTUNG_FELDER: Record<string, string[]> = {
  deckblatt: ['dekblatt', 'deckblat', 'titelseite', 'cover'],
  vorlage: ['template', 'stilvorlage'],
  akzent: ['akzentfarbe', 'farbe', 'accent'],
  kapitelNeueSeite: ['kapitel_neue_seite', 'kapitelneueseite'],
  seitenzahlen: ['seitenzahl', 'pagenumbers']
}

function vereinheitlichen(roh: Record<string, unknown>, felder: Record<string, string[]>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...roh }
  for (const [richtig, andere] of Object.entries(felder)) {
    if (out[richtig] !== undefined && out[richtig] !== '') continue
    const gefunden = andere.find((name) => out[name] !== undefined && out[name] !== '')
    if (gefunden) out[richtig] = out[gefunden]
  }
  return out
}

/**
 * Die Angaben zu create_document auf die richtigen Namen bringen: `inhalt` wird
 * `content`, `titel` wird `title`, `PDF` wird `pdf`. Sonst lehnte das Werkzeug
 * mit „content ist leer“ ab, und das Modell versuchte es wieder und wieder.
 */
export function dokumentAngaben(roh: Record<string, unknown>): Record<string, unknown> {
  const a = vereinheitlichen(roh ?? {}, DOKUMENT_FELDER)
  if (typeof a.format === 'string') {
    const f = a.format.trim().toLowerCase().replace(/^\./, '')
    a.format = f === 'md' ? 'markdown' : f === 'word' || f === 'doc' ? 'docx' : f
  }
  if (a.gestaltung && typeof a.gestaltung === 'object') a.gestaltung = vereinheitlichen(a.gestaltung as Record<string, unknown>, GESTALTUNG_FELDER)
  return a
}

/** Gemeinsame Ausführung von create_document (mit und ohne Arbeitsordner). */
export async function createDocumentTool(
  context: AgentContext,
  rohArgs: Record<string, unknown>
): Promise<{ ok: boolean; output: string; document?: DocumentRef }> {
  const args = dokumentAngaben(rohArgs)
  const kind = String(args.format ?? 'markdown') as DocKind
  if (!['markdown', 'docx', 'pdf'].includes(kind)) {
    return { ok: false, output: 'format muss markdown, docx oder pdf sein' }
  }
  const title = String(args.title ?? '').trim() || 'Dokument'
  const content = String(args.content ?? '')
  if (!content.trim()) {
    return { ok: false, output: 'Kein Text übergeben: Der Inhalt des Dokuments gehört als Markdown in das Feld „content“ (Titel in „title“). Nichts geschrieben.' }
  }

  // Zielpfad: im Arbeitsordner (Sandbox) oder in die Ablage der App.
  const hasFolder = context.folder.length > 0
  let target: string
  let shown: string
  if (hasFolder) {
    const sandbox = await openSandbox(context)
    const requested = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : `${title}${DOC_SUFFIX_OF[kind]}`
    target = await sandbox.resolve(requested)
    shown = relative(sandbox.root, target) || target
  } else {
    // Ein neues Dokument überschreibt nie ein anderes („Anschreiben (2).pdf“) —
    // ändern geht über dokument_bearbeiten.
    target = freierPfad(join(defaultDocumentsDir(), `${sanitize(title)}${DOC_SUFFIX_OF[kind]}`))
    shown = target
  }

  const allowed =
    context.settings.autoApproveWrites ||
    (await context.permissions.ask({
      chatId: context.chatId,
      kind: 'write',
      target: shown,
      detail: `Dokument erzeugen: ${title} (${kind}, ${content.length} Zeichen)`,
      rememberKey: `write:${target}`
    }))
  if (!allowed) return { ok: false, output: 'Vom Benutzer abgelehnt.' }

  const created = await createDocument({
    kind,
    path: target,
    markdown: content,
    title,
    untertitel: typeof args.untertitel === 'string' ? args.untertitel : undefined,
    gestaltung: gestaltungAus(args.gestaltung)
  })
  registerFile(created.path)
  return {
    ok: true,
    output: `${shown} erstellt (${humanSize(created.bytes)})`,
    document: { path: created.path, kind: created.kind, title, bytes: created.bytes }
  }
}

export const DOC_SUFFIX_OF: Record<DocKind, string> = { markdown: '.md', docx: '.docx', pdf: '.pdf' }

/** Die Gestaltungsangabe des Modells auf das Bekannte zurechtstutzen. */
export function gestaltungAus(roh: unknown): Gestaltung | undefined {
  if (!roh || typeof roh !== 'object') return undefined
  const r = vereinheitlichen(roh as Record<string, unknown>, GESTALTUNG_FELDER)
  const g: Gestaltung = {}
  if (r.vorlage === 'klassisch' || r.vorlage === 'modern' || r.vorlage === 'schlicht' || r.vorlage === 'brief') g.vorlage = r.vorlage
  if (typeof r.akzent === 'string') g.akzent = r.akzent
  if (r.schrift === 'serif' || r.schrift === 'sans') g.schrift = r.schrift
  for (const schalter of ['deckblatt', 'kapitelNeueSeite', 'seitenzahlen'] as const) {
    if (typeof r[schalter] === 'boolean') g[schalter] = r[schalter] as boolean
  }
  if (typeof r.css === 'string' && r.css.trim()) g.css = r.css.slice(0, 8000)
  return Object.keys(g).length ? g : undefined
}

/** Kompakte Größenangabe für Rückmeldungen an das Modell. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

function sanitize(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 64) || 'dokument'
}

/**
 * Lauf ohne Arbeitsordner: nur Dokumenterzeugung, geschrieben in die Ablage
 * der App. So gelingen PDF und Word auch im normalen Chat.
 */
export function createDocumentRuntime(context: Omit<AgentContext, 'folder'>): ToolRuntime {
  const folderless: AgentContext = { ...context, folder: '' }
  // Das Web gehört zum normalen Chat: schnelle Suche, eine Seite
  // lesen, gründliche Recherche mit Quellen. Vorher gab es das nur im Agent-Modus —
  // „Tiefere Recherche“ im Plus-Menü lief im Chat ins Leere.
  const namen = ['create_document', 'websuche', 'webseite_lesen', 'recherche']
  return {
    specs: SPECS.filter((candidate) => namen.includes(candidate.name)),
    maxSteps: 14,
    async execute(_callId, name, rawArgs) {
      const args = (rawArgs ?? {}) as Record<string, unknown>
      try {
        if (name === 'create_document') return await createDocumentTool(folderless, args)
        if (name === 'websuche') return await websucheTool(args)
        if (name === 'webseite_lesen') return await seiteTool(args)
        if (name === 'recherche') return await rechercheTool(folderless, args)
        return { ok: false, output: `Unbekanntes Werkzeug: ${name}` }
      } catch (e) {
        return { ok: false, output: (e as Error).message }
      }
    }
  }
}
