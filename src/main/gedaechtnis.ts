/**
 * Gedächtnis und Projektwissen für einen Lauf:
 *
 * - **Einzelne Einträge** statt eines großen Blocks, jeder mit Thema, jeder
 *   einzeln einsehbar, änderbar und löschbar.
 * - **Während des Gesprächs:** Das Modell legt Wichtiges selbst ab
 *   (`erinnerung_merken`), und „merk dir …“ wirkt sofort. Kein nächtlicher
 *   Stapellauf, der ein lokales Modell zusätzlich beschäftigen würde.
 * - **Getrennte Speicher:** ein allgemeiner für Chats ohne Projekt, einer je
 *   Projekt. Ein Projekt lernt nur aus seinen eigenen Chats.
 * - **Sensible Themen** bleiben draußen, solange der Schalter aus ist.
 *
 * Dazu der Projekt-Kontext (siehe kontext.ts): die Dateien eines Projekts,
 * komplett im Prompt oder — wenn es zu viel wird — über eine Suche.
 */
import type { Chat, Erinnerung, Project, Settings } from '@shared/types'
import type { ToolSpec } from './providers/types'
import type { ToolRuntime } from './chat'
import type { Store } from './db'
import { VOLLSTAENDIG_BIS } from './kontext'

/** So viele Einträge stehen höchstens im Prompt; die jüngsten zuerst gekürzt. */
const HOECHSTENS_IM_PROMPT = 120

/** Kurze, gut lesbare Kennung: die ersten acht Zeichen reichen zum Wiederfinden. */
export function kurzId(id: string): string {
  return id.slice(0, 8)
}

function projektVon(store: Store, chat: Chat): Project | undefined {
  return chat.projectId ? store.listProjects().find((p) => p.id === chat.projectId) : undefined
}

function speicherName(projekt: Project | undefined): string {
  return projekt ? `Gedächtnis des Projekts „${projekt.name}“` : 'Allgemeines Gedächtnis'
}

function eintragZeile(e: Erinnerung): string {
  return `- [${kurzId(e.id)}] ${e.thema}: ${e.text.replace(/\s+/g, ' ')}`
}

/**
 * Die Teile für den Systemprompt: was im Gedächtnis steht, wie damit
 * umzugehen ist, und was das Projekt an Wissen mitbringt.
 */
export function gedaechtnisTeile(store: Store, chat: Chat, settings: Settings, mitWerkzeugen: boolean): string[] {
  const teile: string[] = []
  const projekt = projektVon(store, chat)

  if (settings.gedaechtnisAn) {
    const eintraege = store.listErinnerungen(projekt?.id).slice(0, HOECHSTENS_IM_PROMPT)
    const liste = eintraege.length ? eintraege.map(eintragZeile).join('\n') : '(noch leer)'
    const regeln = mitWerkzeugen
      ? [
          'So gehst du mit dem Gedächtnis um:',
          '- Nutze, was dort steht, wenn es zur Anfrage passt — ohne es jedes Mal zu erwähnen.',
          '- Erfährst du etwas Dauerhaftes und Nützliches (Beruf, Ziele, laufende Vorhaben, Vorlieben für Antworten, wiederkehrende Fakten), lege es mit erinnerung_merken ab: ein Eintrag je Sachverhalt, knapp, in der dritten Person.',
          '- Sagt die Nutzer:in „merk dir …“ oder „vergiss …“, tu es sofort (erinnerung_merken bzw. erinnerung_loeschen).',
          '- Ist ein Eintrag überholt, ändere ihn mit erinnerung_aendern statt einen zweiten anzulegen.',
          '- Nichts Einmaliges merken (eine einzelne Rechnung, eine Wegbeschreibung), keine Passwörter, Ausweis- oder Kontonummern.',
          settings.gedaechtnisSensibel
            ? ''
            : '- Gesundheit, Religion, politische Ansichten, ethnische Herkunft und geschlechtliche Identität niemals ins Gedächtnis schreiben — auch wenn sie im Gespräch vorkommen.'
        ]
          .filter(Boolean)
          .join('\n')
      : 'Nutze, was dort steht, wenn es zur Anfrage passt.'
    teile.push(`${speicherName(projekt)} (Einträge mit Kennung):\n${liste}\n\n${regeln}`)
  }

  if (projekt) {
    const kontext = projektKontextTeil(store, projekt, mitWerkzeugen)
    if (kontext) teile.push(kontext)
  }
  return teile
}

function projektKontextTeil(store: Store, projekt: Project, mitWerkzeugen: boolean): string {
  const dateien = store.listProjektDateien(projekt.id)
  if (dateien.length === 0) return ''
  const summe = dateien.reduce((s, d) => s + d.zeichen, 0)

  if (summe <= VOLLSTAENDIG_BIS) {
    const texte = store
      .projektTexte(projekt.id)
      .map((datei) => `<datei name="${datei.name}">\n${datei.text}\n</datei>`)
      .join('\n\n')
    return (
      `Projektwissen „${projekt.name}“ — diese Dateien hat die Nutzer:in ins Projekt gelegt. ` +
      `Stütze dich darauf, wenn die Anfrage sie betrifft (z. B. Angaben aus einem Lebenslauf in ein Anschreiben übernehmen), ` +
      `und erfinde nichts, was dort nicht steht.\n\n${texte}`
    )
  }

  const liste = dateien.map((d) => `- ${d.name} (${d.art}, ${Math.round(d.zeichen / 1000)} Tsd. Zeichen)`).join('\n')
  return mitWerkzeugen
    ? `Projektwissen „${projekt.name}“ (Suchmodus — zu umfangreich, um es komplett mitzugeben). Diese Dateien liegen im Projekt:\n${liste}\n\n` +
        'Braucht die Anfrage etwas daraus, suche zuerst mit projekt_durchsuchen (Stichwörter, auch Synonyme versuchen) ' +
        'oder lies eine Datei mit projekt_datei_lesen. Erfinde nichts, was dort nicht steht.'
    : `Im Projekt „${projekt.name}“ liegen diese Dateien, sie sind aber zu umfangreich für diese Unterhaltung, und dieses Modell kann nicht darin suchen:\n${liste}`
}

// ------------------------------------------------------------------ Werkzeuge

const SPEZ_MERKEN: ToolSpec = {
  name: 'erinnerung_merken',
  description: 'Legt einen neuen Eintrag im Gedächtnis ab (im Projekt-Gedächtnis, wenn der Chat zu einem Projekt gehört).',
  parameters: {
    type: 'object',
    properties: {
      thema: { type: 'string', description: 'Kurzes Thema zum Gruppieren, z. B. „Beruf“, „Vorlieben“, „Bewerbung“' },
      text: { type: 'string', description: 'Der Sachverhalt, knapp und in der dritten Person' }
    },
    required: ['thema', 'text'],
    additionalProperties: false
  }
}

const SPEZ_AENDERN: ToolSpec = {
  name: 'erinnerung_aendern',
  description: 'Ersetzt den Text eines bestehenden Eintrags (Kennung aus der Liste im Systemprompt).',
  parameters: {
    type: 'object',
    properties: {
      kennung: { type: 'string', description: 'Die Kennung in eckigen Klammern, z. B. 3f9a1c2b' },
      text: { type: 'string', description: 'Der neue Text' },
      thema: { type: 'string', description: 'Optional ein neues Thema' }
    },
    required: ['kennung', 'text'],
    additionalProperties: false
  }
}

const SPEZ_LOESCHEN: ToolSpec = {
  name: 'erinnerung_loeschen',
  description: 'Löscht einen Eintrag aus dem Gedächtnis (Kennung aus der Liste im Systemprompt).',
  parameters: {
    type: 'object',
    properties: { kennung: { type: 'string', description: 'Die Kennung in eckigen Klammern' } },
    required: ['kennung'],
    additionalProperties: false
  }
}

const SPEZ_SUCHEN: ToolSpec = {
  name: 'projekt_durchsuchen',
  description: 'Durchsucht die Dateien im Projekt nach Stichwörtern und liefert die passendsten Abschnitte mit Dateinamen.',
  parameters: {
    type: 'object',
    properties: { anfrage: { type: 'string', description: 'Stichwörter, z. B. „Berufserfahrung Projektleitung 2021“' } },
    required: ['anfrage'],
    additionalProperties: false
  }
}

const SPEZ_LESEN: ToolSpec = {
  name: 'projekt_datei_lesen',
  description: 'Liest den Text einer Datei im Projekt, auf Wunsch ab einer Zeichenposition.',
  parameters: {
    type: 'object',
    properties: {
      datei: { type: 'string', description: 'Dateiname, wie in der Liste im Systemprompt' },
      ab: { type: 'number', description: 'Ab welchem Zeichen lesen (Standard 0)' }
    },
    required: ['datei'],
    additionalProperties: false
  }
}

export interface GedaechtnisKontext {
  store: Store
  chat: Chat
  settings: Settings
  /** Meldet der Oberfläche, dass sich ein Speicher geändert hat. */
  geaendert?: (projectId?: string) => void
}

type Ergebnis = { ok: boolean; output: string }

/** Gleiche Grenzen wie in der Oberfläche — ein einmal eingeschleuster Riesentext bläht sonst jeden Prompt auf. */
const MAX_TEXT = 2000
const MAX_THEMA = 80

/** Einen Eintrag über seine Kurzkennung finden — nur im Speicher dieses Chats, und nur eindeutig. */
function finde(ctx: GedaechtnisKontext, kennung: string): Erinnerung | undefined {
  const k = kennung.trim().replace(/^\[|\]$/g, '').toLowerCase()
  if (k.length < 4) return undefined
  const treffer = ctx.store.listErinnerungen(ctx.chat.projectId).filter((e) => e.id.toLowerCase().startsWith(k))
  return treffer.length === 1 ? treffer[0] : undefined
}

function text(wert: unknown): string {
  return typeof wert === 'string' ? wert : ''
}

/**
 * Legt die Werkzeuge für Gedächtnis und Projektwissen um einen bestehenden
 * Werkzeugkasten (wie `mitSkills`). Ohne Gedächtnis und ohne Projektdateien
 * bleibt der Kasten unverändert.
 */
export function mitGedaechtnis(runtime: ToolRuntime | undefined, ctx: GedaechtnisKontext): ToolRuntime | undefined {
  const { store, chat, settings } = ctx
  const specs: ToolSpec[] = []
  if (settings.gedaechtnisAn) specs.push(SPEZ_MERKEN, SPEZ_AENDERN, SPEZ_LOESCHEN)
  const hatDateien = Boolean(chat.projectId && store.listProjektDateien(chat.projectId).length > 0)
  if (hatDateien) specs.push(SPEZ_SUCHEN, SPEZ_LESEN)
  if (specs.length === 0) return runtime

  const ausfuehren = (name: string, args: Record<string, unknown>): Ergebnis | undefined => {
    switch (name) {
      case SPEZ_MERKEN.name: {
        const inhalt = text(args.text).trim()
        if (!inhalt) return { ok: false, output: 'Kein Text angegeben.' }
        if (inhalt.length > MAX_TEXT) return { ok: false, output: `Zu lang (höchstens ${MAX_TEXT} Zeichen) — knapper fassen, ein Eintrag je Sachverhalt.` }
        const doppelt = store.listErinnerungen(chat.projectId).find((e) => e.text.trim().toLowerCase() === inhalt.toLowerCase())
        if (doppelt) return { ok: true, output: `Steht schon im Gedächtnis [${kurzId(doppelt.id)}].` }
        const neu = store.addErinnerung({ projectId: chat.projectId, thema: text(args.thema).slice(0, MAX_THEMA) || 'Allgemein', text: inhalt, chatId: chat.id })
        ctx.geaendert?.(chat.projectId)
        return { ok: true, output: `Gemerkt [${kurzId(neu.id)}] ${neu.thema}: ${neu.text}` }
      }
      case SPEZ_AENDERN.name: {
        const eintrag = finde(ctx, text(args.kennung))
        if (!eintrag) return { ok: false, output: `Keinen eindeutigen Eintrag mit der Kennung „${text(args.kennung)}“ gefunden.` }
        const neuerText = text(args.text).trim()
        if (!neuerText) return { ok: false, output: 'Der neue Text ist leer — zum Entfernen erinnerung_loeschen nutzen.' }
        if (neuerText.length > MAX_TEXT) return { ok: false, output: `Zu lang (höchstens ${MAX_TEXT} Zeichen).` }
        const neu = store.updateErinnerung(eintrag.id, { text: neuerText, thema: text(args.thema).slice(0, MAX_THEMA) || undefined })
        ctx.geaendert?.(chat.projectId)
        return { ok: true, output: `Geändert [${kurzId(eintrag.id)}] ${neu?.thema}: ${neu?.text}` }
      }
      case SPEZ_LOESCHEN.name: {
        const eintrag = finde(ctx, text(args.kennung))
        if (!eintrag) return { ok: false, output: `Keinen eindeutigen Eintrag mit der Kennung „${text(args.kennung)}“ gefunden.` }
        store.deleteErinnerung(eintrag.id)
        ctx.geaendert?.(chat.projectId)
        return { ok: true, output: `Gelöscht [${kurzId(eintrag.id)}] ${eintrag.text}` }
      }
      case SPEZ_SUCHEN.name: {
        if (!chat.projectId) return { ok: false, output: 'Dieser Chat gehört zu keinem Projekt.' }
        const treffer = store.sucheImProjekt(chat.projectId, text(args.anfrage))
        if (treffer.length === 0) return { ok: true, output: 'Keine Treffer. Andere Stichwörter oder Synonyme versuchen, oder eine Datei direkt lesen.' }
        return { ok: true, output: treffer.map((t, i) => `[${i + 1}] aus „${t.datei}“:\n${t.text}`).join('\n\n---\n\n') }
      }
      case SPEZ_LESEN.name: {
        if (!chat.projectId) return { ok: false, output: 'Dieser Chat gehört zu keinem Projekt.' }
        const ab = typeof args.ab === 'number' && Number.isFinite(args.ab) ? Math.max(0, Math.floor(args.ab)) : 0
        const datei = store.projektDateiText(chat.projectId, text(args.datei), ab)
        if (!datei) {
          const namen = store.listProjektDateien(chat.projectId).map((d) => d.name).join(', ')
          return { ok: false, output: `Keine Datei „${text(args.datei)}“ im Projekt. Vorhanden: ${namen}` }
        }
        const bis = ab + datei.text.length
        const weiter = bis < datei.gesamt ? `\n\n(Zeichen ${ab}–${bis} von ${datei.gesamt}. Weiterlesen mit ab=${bis}.)` : ''
        return { ok: true, output: `# ${datei.name}\n\n${datei.text}${weiter}` }
      }
      default:
        return undefined
    }
  }

  return {
    specs: [...(runtime?.specs ?? []), ...specs],
    maxSteps: runtime?.maxSteps,
    async execute(callId, name, args) {
      try {
        const eigenes = ausfuehren(name, (args ?? {}) as Record<string, unknown>)
        if (eigenes) return eigenes
      } catch (e) {
        return { ok: false, output: (e as Error).message }
      }
      if (!runtime) return { ok: false, output: `Unbekanntes Werkzeug: ${name}` }
      return runtime.execute(callId, name, args)
    }
  }
}
