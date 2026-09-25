import { BrowserWindow } from 'electron'
/**
 * Lauf-Orchestrierung: Historie aufbauen → Anbieter streamen → Ereignisse an den
 * Renderer melden → Assistant-Nachricht fortlaufend persistieren.
 *
 * Wichtig: Für Läufe mit Werkzeugen ist das Gesprächsprotokoll (`protocol`) die
 * einzige Wahrheitsquelle für den nächsten Schritt. Wird es aus der Datenbank
 * rekonstruiert, fehlen die Assistent-Runden und das Modell wiederholt Schritte.
 */
import { appendTextPart } from '@shared/parts'
import { anfrageBeginnt, anfrageEndet } from './lib/wachhalten'
import { benachrichtige } from './lib/benachrichtigen'
import { randomUUID } from 'node:crypto'
import type { Chat, ContentPart, DocumentRef, Message, Skill, StreamEvent } from '@shared/types'
import { startModell } from '@shared/startmodell'
import { skillAusgeloest, skillVerzeichnis } from './skills'
import { gedaechtnisTeile } from './gedaechtnis'
import { dokumentTeile } from './dokumente'
import { verlaufTeile } from './verlauf'
import type { Store } from './db'
import type { SettingsService } from './settings'
import { antwortRaum, denkBudget, denkRegel } from '@shared/reasoning'
import type { ProviderRegistry } from './providers'
import type { GenerateHandlers, GenerateRequest, LlmMessage, ToolCall } from './providers/types'
import { log } from './logger'
import { computeMetrics, estimateTokens } from './metrics'
import { tiefenrecherche, tiefGrundlage, type ModellFrage, type Schritte } from './research/tief'

/** Vom Agenten bereitgestellte Werkzeuge und deren Ausführung. */
export interface ToolRuntime {
  specs: import('./providers/types').ToolSpec[]
  execute(callId: string, name: string, args: unknown): Promise<{ ok: boolean; output: string; document?: DocumentRef }>
  /** Schutz vor endlosen Schleifen; Standard 12 Schritte. */
  maxSteps?: number
}

export interface RunOptions {
  /** Kennung des Laufs; wird vom Aufruhr vergeben, damit der sofort antworten kann. */
  streamId?: string
  chatId: string
  text: string
  images?: { mediaType: string; dataBase64: string }[]
  files?: { name: string; mediaType: string; text: string }[]
  model?: string
  effort?: 'low' | 'medium' | 'high'
  tools?: ToolRuntime
  /** Aktive Skills: ihr Verzeichnis steht im Systemprompt. */
  skills?: Skill[]
  /** Keine eigene Meldung — der Aufrufer meldet selbst (geplante Aufträge). */
  stumm?: boolean
  /** Bearbeiten: die neue Frage wird Schwester dieser Nachricht; deren Anhänge bleiben. */
  ersetzt?: string
  /** Neu erzeugen: auf diese bestehende Frage noch einmal antworten. */
  antwortAuf?: string
  /** Websuche eingeschaltet: im Web nachsehen, mit Quellen. */
  websuche?: boolean
  /** Tiefenrecherche: vorab planen, breit suchen, Quellen auswerten — dann der Bericht. */
  tiefenrecherche?: boolean
}

const MAX_TOOL_STEPS_DEFAULT = 12
const DB_FLUSH_MS = 400

/** Kurze, sachliche Anleitung — die Werkzeuge selbst sind bereits beschrieben. */
function systemPrompt(chat: Chat, hasTools: boolean, zusatz: string[] = []): string {
  // Lokale Modelle weichen gern auf ae/oe/ue aus, sobald sie Dateinamen oder
  // Überschriften schreiben — das soll nirgends passieren.
  const base =
    'Antworte in der Sprache der Nutzer:in. Schreibe Deutsch immer mit echten Umlauten und ß (ä, ö, ü, Ä, Ö, Ü, ß) — ' +
    'auch in Dateinamen, Titeln und Überschriften, niemals als ae, oe, ue oder ss.'
  const anhang = zusatz.filter((teil) => teil.trim().length > 0)
  // Das heutige Datum — ohne es hält das Modell sein Trainingsende für heute,
  // und „aktuell“, „gestern“, „diese Woche“ gehen daneben (auch bei der Websuche).
  const heute = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return [`${grundPrompt(chat, hasTools, base)} Heute ist ${heute}.`, ...anhang].join('\n\n')
}

function grundPrompt(chat: Chat, hasTools: boolean, base: string): string {
  if (chat.mode === 'agent') {
    return [
      `Du arbeitest in der Desktop-App in diesem Ordner: ${chat.folder ?? '(kein Ordner gewählt)'}.`,
      'Nutze die Werkzeuge, um Dateien wirklich zu lesen und zu ändern.',
      'Führe jeden Werkzeugaufruf nur einmal aus, wenn er dasselbe Ergebnis liefert. Arbeite zielgerichtet zum Ende.',
      hasTools ? 'Wenn die Aufgabe erledigt ist, fasse in ein bis zwei Sätzen zusammen.' : '',
      base
    ]
      .filter(Boolean)
      .join(' ')
  }
  return `Du bist der Chat-Assistent in der Desktop-App. ${base}`
}

/** Dauerhafte Nachrichten → Anbieter-Protokoll (für den ersten Schritt). */
function toLlmMessages(chat: Chat, history: Message[], tools: boolean, zusatz: string[] = []): LlmMessage[] {
  const out: LlmMessage[] = [{ role: 'system', content: systemPrompt(chat, tools, zusatz) }]
  for (const message of history) {
    if (message.role === 'system') continue

    const texts = message.parts.filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    const images = message.parts.filter((p): p is Extract<ContentPart, { type: 'image' }> => p.type === 'image')
    const files = message.parts.filter((p): p is Extract<ContentPart, { type: 'file' }> => p.type === 'file')
    const calls = message.parts.filter((p): p is Extract<ContentPart, { type: 'tool_call' }> => p.type === 'tool_call')
    const results = message.parts.filter((p): p is Extract<ContentPart, { type: 'tool_result' }> => p.type === 'tool_result')

    let content = texts.map((t) => t.text).join('\n')
    if (files.length) content += '\n\n' + files.map((f) => `--- Datei: ${f.name} ---\n${f.text}`).join('\n\n')

    // Nur Rufe mit Ergebnis zählen: Brach ein Lauf ab (Stopp, Schrittgrenze),
    // bevor ein Werkzeug lief, stünde sonst ein Ruf ohne Antwort im Verlauf —
    // OpenAI-kompatible Server lehnen dann jede weitere Anfrage im Chat ab.
    const beantwortet = calls.filter((c) => results.some((r) => r.id === c.id))
    if (beantwortet.length > 0) {
      // Assistent-Runde mit Werkzeugrufen; die Ergebnisse folgen als eigene Rollen.
      out.push({ role: 'assistant', content, toolCalls: beantwortet.map((c) => ({ id: c.id, name: c.tool, args: c.args })) })
      for (const result of results) {
        if (!beantwortet.some((c) => c.id === result.id)) continue
        out.push({ role: 'user', content: '', toolResult: { callId: result.id, name: result.tool, ok: result.ok, output: result.output } })
      }
      continue
    }

    if (!content && images.length === 0) continue
    out.push({
      role: message.role,
      content,
      ...(images.length ? { images: images.map((i) => ({ mediaType: i.mediaType, dataBase64: i.dataBase64 })) } : {})
    })
  }
  return out
}

/** Ein Lauf: kapselt Protokoll, Anzeige-Puffer und Persistenz. */
class Run {
  private protocol: LlmMessage[]
  /** Sichtbare Anteile über alle Schritte hinweg. */
  private thinking = ''
  private stepTexts: string[] = ['']
  private parts: ContentPart[] = []
  private lastFlush = 0
  /** Laufzeit und Anbietermeldung für die Durchsatzanzeige unter der Antwort. */
  private startedAt = Date.now()
  /**
   * Zeit, in der das Modell nicht schrieb: Werkzeuge liefen oder es wurde auf
   * eine Freigabe gewartet. Sie zählt nicht zum Durchsatz — sonst hieße fünf
   * Minuten Zögern vor „Erlauben" „0,2 Token/s".
   */
  private pausiert = 0
  private usage: { input?: number; output?: number } = {}
  /**
   * Summe der abgeschlossenen Anfragen. Ein Lauf besteht oft aus mehreren —
   * Werkzeugschritte, ein gekapptes Denken mit Nachfrage. Gezählt wurde bisher
   * nur die letzte; „3 Token" nach 350 gedachten war die Folge.
   */
  private bisher = { input: 0, output: 0 }

  constructor(
    private assistantMessage: Message,
    protocol: LlmMessage[],
    private store: Store,
    private emit: (event: StreamEvent) => void,
    private streamId: string,
    private chatId: string
  ) {
    this.protocol = protocol
  }

  protocolMessages(): LlmMessage[] {
    return this.protocol
  }

  /** Handler für einen einzelnen Schritt; gesammelte Aufrufe landen in `calls`. */
  handlersFor(calls: ToolCall[]): GenerateHandlers {
    const currentStep = this.stepTexts.length - 1
    return {
      onText: (text) => {
        this.stepTexts[currentStep] = (this.stepTexts[currentStep] ?? '') + text
        this.appendText(text)
        this.emit({ streamId: this.streamId, type: 'delta_text', chatId: this.chatId, messageId: this.assistantMessage.id, text })
        this.flush()
      },
      onThinking: (text) => {
        this.thinking += text
        this.emit({ streamId: this.streamId, type: 'delta_thinking', chatId: this.chatId, messageId: this.assistantMessage.id, text })
        this.flush()
      },
      onToolCall: (call) => {
        calls.push(call)
        this.emit({
          streamId: this.streamId,
          type: 'tool_call',
          chatId: this.chatId,
          messageId: this.assistantMessage.id,
          callId: call.id,
          tool: call.name,
          args: call.args
        })
      },
      onUsage: (usage) => {
        // Letzte Meldung gewinnt: Anbieter schicken die Endsumme am Schluss.
        if (typeof usage.output === 'number' && usage.output > 0) this.usage.output = usage.output
        if (typeof usage.input === 'number' && usage.input > 0) this.usage.input = usage.input
      }
    }
  }

  /**
   * Antworttext in die sichtbare Reihenfolge einreihen: läuft der Text weiter,
   * wird angehängt; nach einem Werkzeugblock beginnt ein eigener Textanteil.
   * Sonst klebt am Ende aus drei Sätzen einer — und die Reihenfolge der
   * Werkzeuge verliert ihren Sinn.
   */
  private appendText(text: string): void {
    this.parts = appendTextPart(this.parts, text)
  }

  /** Der Anfang der Antwort in einer Zeile — für die Meldung draußen. */
  vorschau(): string {
    return this.stepTexts
      .join(' ')
      .replace(/[#*_`>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180)
  }

  /** Eine Anfrage ist durch: ihre Endsumme in die Gesamtsumme übernehmen. */
  anfrageFertig(): void {
    this.bisher.output += this.usage.output ?? 0
    this.bisher.input += this.usage.input ?? 0
    this.usage = {}
  }

  /** Eine abgebrochene Anfrage meldet keine Summe — dann aus dem Text schätzen. */
  anfrageGeschaetzt(zeichen: number): void {
    this.bisher.output += estimateTokens(zeichen)
    this.usage = {}
  }

  pause(ms: number): void {
    this.pausiert += Math.max(0, ms)
  }

  /**
   * Sichtbare Schritte eines vorgeschalteten Ablaufs (Tiefenrecherche): sie
   * stehen in der Zeitlinie, aber nicht im Protokoll — das Modell bekommt am
   * Ende nur die Zusammenfassung, nicht jeden Zwischenschritt.
   */
  schritte(): Schritte {
    return {
      beginn: (tool, args) => {
        const id = `s-${randomUUID().slice(0, 8)}`
        this.parts.push({ type: 'tool_call', id, tool, args })
        this.emit({ streamId: this.streamId, type: 'tool_call', chatId: this.chatId, messageId: this.assistantMessage.id, callId: id, tool, args })
        this.flush()
        return id
      },
      ende: (id, tool, ok, output) => {
        this.parts.push({ type: 'tool_result', id, tool, ok, output: output.slice(0, 8000) })
        this.emit({ streamId: this.streamId, type: 'tool_result', chatId: this.chatId, messageId: this.assistantMessage.id, callId: id, tool, ok, preview: output.slice(0, 2000) })
        this.flush()
      }
    }
  }

  /** Ergebnis eines vorgeschalteten Werkzeugs ins Protokoll: als Aufruf mit Antwort. */
  vorabErgebnis(call: ToolCall, ok: boolean, output: string, alsWerkzeug: boolean): void {
    if (alsWerkzeug) {
      this.protocol.push({ role: 'assistant', content: '', toolCalls: [call] })
      this.protocol.push({ role: 'user', content: '', toolResult: { callId: call.id, name: call.name, ok, output } })
    } else {
      // Modell ohne Werkzeuge: das Ergebnis als gewöhnliche Nachricht.
      this.protocol.push({ role: 'user', content: `Ergebnis der Tiefenrecherche:\n\n${output}` })
    }
  }

  /** Assistent-Runde ins Protokoll übernehmen und Werkzeugergebnis anhängen. */
  recordAssistantTurn(calls: ToolCall[]): void {
    const text = this.stepTexts[this.stepTexts.length - 1] ?? ''
    this.protocol.push({ role: 'assistant', content: text, ...(calls.length ? { toolCalls: calls } : {}) })
    for (const call of calls) this.parts.push({ type: 'tool_call', id: call.id, tool: call.name, args: call.args })
  }

  recordToolResult(call: ToolCall, ok: boolean, output: string, document?: DocumentRef): void {
    this.protocol.push({ role: 'user', content: '', toolResult: { callId: call.id, name: call.name, ok, output } })
    this.parts.push({ type: 'tool_result', id: call.id, tool: call.name, ok, output: output.slice(0, 8000) })
    // Erzeugte Dokumente bekommen einen eigenen Teil — die Oberfläche zeigt
    // daraus eine Karte, die das Rechts-Panel öffnet.
    if (ok && document) this.parts.push({ ...document, type: 'document' })
    this.stepTexts.push('')
    this.flush(true)
  }

  finish(error?: string): void {
    // Durchsatz als eigener Teil an die Antwort hängen: bleibt in der Datenbank
    // stehen und ist damit auch nach einem Neustart noch sichtbar.
    const metrics = computeMetrics({
      usage: {
        output: this.bisher.output + (this.usage.output ?? 0) || undefined,
        input: this.bisher.input + (this.usage.input ?? 0) || undefined
      },
      chars: this.stepTexts.filter(Boolean).join('').length,
      durationMs: Math.max(1, Date.now() - this.startedAt - this.pausiert)
    })
    this.parts.push({ type: 'metrics', ...metrics })
    this.flush(true)
    this.emit({ streamId: this.streamId, type: 'usage', chatId: this.chatId, messageId: this.assistantMessage.id, ...metrics })
    if (error && !this.store.isClosed) this.store.updateMessage(this.assistantMessage.id, { error })
  }

  /** Sichtbarer Zustand: Denktext zuerst, dann Antwort und Werkzeugprotokoll in der Reihenfolge, in der sie geschahen. */
  private snapshot(): ContentPart[] {
    const parts: ContentPart[] = []
    if (this.thinking) parts.push({ type: 'thinking', text: this.thinking })
    // Leere Textanteile (ein Schritt ohne Satz) mitnehmen wäre nur Ballast.
    parts.push(...this.parts.filter((part) => part.type !== 'text' || part.text.trim().length > 0))
    return parts
  }

  private flush(force = false): void {
    if (this.store.isClosed) return
    const now = Date.now()
    if (!force && now - this.lastFlush < DB_FLUSH_MS) return
    this.lastFlush = now
    try {
      this.store.updateMessage(this.assistantMessage.id, { parts: this.snapshot() })
    } catch {
      /* App beendet gerade — kein Grund zu fallen */
    }
  }
}

export class ChatRunner {
  private active = new Map<string, AbortController>()
  /** Welcher Lauf zu welchem Chat gehört — für das Aufräumen beim Stop. */
  private chatOf = new Map<string, string>()
  /**
   * Wird beim Stop gerufen. Eine offene Freigabe hielte den Lauf sonst bis zu
   * fünf Minuten fest, obwohl niemand mehr auf ihn wartet.
   */
  beiStop?: (chatId: string) => void

  constructor(
    private store: Store,
    private registry: ProviderRegistry,
    private settings: SettingsService
  ) {}

  /**
   * Was außer der Grundanweisung in den Systemprompt gehört: die Anweisungen
   * des Projekts, zu dem der Chat gehört. Sie wurden bislang gespeichert und
   * angezeigt, erreichten das Modell aber nie.
   */
  private zusatzFuer(chat: Chat, opts: RunOptions): string[] {
    const teile: string[] = []
    if (chat.projectId) {
      const projekt = this.store.listProjects().find((p) => p.id === chat.projectId)
      if (projekt?.instructions?.trim()) teile.push(`Anweisungen für das Projekt „${projekt.name}“:\n${projekt.instructions.trim()}`)
    }
    // Gedächtnis und Projektwissen. Die Regeln fürs Merken und Suchen stehen
    // nur da, wenn das Modell die Werkzeuge dazu auch bekommen hat.
    const werkzeuge = new Set(opts.tools?.specs.map((spec) => spec.name) ?? [])
    teile.push(...gedaechtnisTeile(this.store, chat, this.settings.get(), werkzeuge.has('erinnerung_merken') || werkzeuge.has('projekt_durchsuchen')))
    // Welche Dokumente es hier schon gibt — damit „ergänze noch eine Zeile“ das
    // bestehende ändert statt ein neues zu schreiben.
    teile.push(...dokumentTeile(this.store, chat, werkzeuge.has('dokument_bearbeiten')))
    teile.push(...verlaufTeile(chat, werkzeuge.has('chats_durchsuchen')))
    // Der Schalter „Tiefere Recherche“ im Eingabefeld: die Anweisung geht hier
    // mit, statt als Text im Eingabefeld zu stehen.
    if (opts.tiefenrecherche) {
      teile.push(
        'Für diese Frage wurde vorab eine Tiefenrecherche durchgeführt; ihr Ergebnis (Teilfragen und nummerierte Quellen mit Notizen) steht im ' +
          'Werkzeugergebnis „tiefenrecherche“. Schreibe daraus einen ausführlichen, gut gegliederten Bericht: eine kurze Zusammenfassung vorweg, ' +
          'dann je Teilfrage ein Abschnitt mit den belegten Fakten, danach Widersprüche zwischen Quellen und offene Punkte. Belege jede Aussage mit ' +
          '[n] — genau den Nummern aus dem Ergebnis — und schließe mit dem Quellenverzeichnis. Erfinde nichts, was nicht in den Notizen steht. ' +
          'Suche nur dann noch einmal, wenn etwas Wesentliches fehlt.'
      )
    } else if (opts.websuche && (werkzeuge.has('recherche') || werkzeuge.has('websuche'))) {
      teile.push(
        'Die Nutzer:in hat die Websuche eingeschaltet. Sieh für diese Frage im Web nach: stelle Suchanfragen, lies die passenden Seiten und ' +
          'belege die Antwort mit nummerierten Quellenangaben [1], [2] … und einem kurzen Quellenverzeichnis am Ende. ' +
          'Wenn es nichts nachzusehen gibt (etwa bei einer Begrüßung), antworte normal.'
      )
    }
    const skills = opts.skills ?? []
    // Ohne Werkzeuge kann das Modell nichts nachladen — dann nur die Liste.
    const mitWerkzeug = Boolean(opts.tools?.specs.some((spec) => spec.name === 'skill_laden'))
    teile.push(skillVerzeichnis(skills, mitWerkzeug))
    // `/name` am Anfang: die Anleitung gleich mitgeben, nicht erst laden lassen.
    const gewaehlt = skillAusgeloest(opts.text, skills)
    if (gewaehlt) {
      teile.push(`Die Nutzer:in hat den Skill „${gewaehlt.name}“ ausgelöst. Folge dieser Anleitung:\n\n${gewaehlt.body}`)
    }
    return teile
  }

  /** Stelle einer Nachricht unter ihren Schwestern (‹ 2/3 ›). */
  private zweigVon(id: string): { index: number; anzahl: number } {
    const schwestern = this.store.schwestern(id)
    return { index: Math.max(1, schwestern.findIndex((m) => m.id === id) + 1), anzahl: Math.max(1, schwestern.length) }
  }

  get runningCount(): number {
    return this.active.size
  }

  stop(streamId: string): void {
    this.active.get(streamId)?.abort()
    const chatId = this.chatOf.get(streamId)
    if (chatId) this.beiStop?.(chatId)
  }

  /** Alle Läufe eines Chats anhalten (etwa, weil er gelöscht wird). */
  stopChat(chatId: string): void {
    for (const [streamId, id] of this.chatOf) if (id === chatId) this.stop(streamId)
  }

  stopAll(): void {
    for (const streamId of [...this.active.keys()]) this.stop(streamId)
  }

  async send(opts: RunOptions, emit: (event: StreamEvent) => void): Promise<{ streamId: string }> {
    const streamId = opts.streamId ?? randomUUID()
    const chat = this.store.getChat(opts.chatId)
    if (!chat) throw new Error('Chat nicht gefunden')
    // Eine Antwort nach der anderen: ein zweiter Lauf (etwa vom Handy) hinge
    // seine Frage sonst unter die noch leere Antwort des ersten.
    // Ein gestoppter Lauf zählt nicht mehr, auch wenn er gerade noch aufräumt.
    if ([...this.chatOf].some(([id, c]) => c === chat.id && !this.active.get(id)?.signal.aborted)) throw new Error('In diesem Chat entsteht gerade noch eine Antwort. Warte kurz oder stoppe sie.')

    let userMessage: Message
    if (opts.antwortAuf) {
      // Neu erzeugen: die Frage bleibt, die Antwort wird eine weitere Fassung.
      const frage = this.store.getMessage(opts.antwortAuf)
      if (!frage || frage.chatId !== chat.id || frage.role !== 'user') throw new Error('Die Frage zu dieser Antwort gibt es nicht mehr.')
      this.store.setzeBlatt(chat.id, frage.id)
      userMessage = frage
    } else {
      // Bearbeiten: neben die alte Frage, mit deren Anhängen, wenn keine neuen kommen.
      const alt = opts.ersetzt ? this.store.getMessage(opts.ersetzt) : undefined
      if (opts.ersetzt && (!alt || alt.chatId !== chat.id)) throw new Error('Die Nachricht gibt es nicht mehr.')
      const alteBilder = alt?.parts.filter((p) => p.type === 'image') ?? []
      const alteDateien = alt?.parts.filter((p) => p.type === 'file') ?? []
      userMessage = {
        id: randomUUID(),
        chatId: chat.id,
        role: 'user',
        createdAt: Date.now(),
        parts: [
          ...(opts.text ? [{ type: 'text' as const, text: opts.text }] : []),
          ...(opts.images?.length ? opts.images.map((i) => ({ type: 'image' as const, ...i })) : alteBilder),
          ...(opts.files?.length ? opts.files.map((f) => ({ type: 'file' as const, ...f })) : alteDateien)
        ]
      }
      userMessage = this.store.insertMessage(userMessage, alt ? (alt.parentId ?? null) : undefined)
      const titleCandidate = opts.text.trim().replace(/\s+/g, ' ').slice(0, 60)
      if (chat.title === 'Neuer Chat' && titleCandidate) this.store.renameChat(chat.id, titleCandidate)
    }
    userMessage = { ...userMessage, zweig: this.zweigVon(userMessage.id) }

    const assistantMessage: Message = {
      id: randomUUID(),
      chatId: chat.id,
      role: 'assistant',
      createdAt: Date.now(),
      parts: []
    }
    this.store.insertMessage(assistantMessage)
    emit({ streamId, type: 'start', chatId: chat.id, messageId: assistantMessage.id, userMessage, zweig: this.zweigVon(assistantMessage.id) })

    const controller = new AbortController()
    this.active.set(streamId, controller)
    this.chatOf.set(streamId, chat.id)
    anfrageBeginnt()
    // Für die Meldung nach außen: was ist am Ende geschehen?
    let fehlertext: string | null = null
    const startedAt = Date.now()

    const bezug = opts.model ?? chat.model ?? startModell(this.settings.get(), chat.mode)
    const resolved = this.registry.resolve(bezug)
    if (!resolved) {
      const message = 'Kein Anbieter eingerichtet.'
      this.store.updateMessage(assistantMessage.id, { error: message })
      emit({ streamId, type: 'error', chatId: chat.id, messageId: assistantMessage.id, message })
      this.active.delete(streamId)
      this.chatOf.delete(streamId)
      anfrageEndet()
      return { streamId }
    }
    const model = resolved.model || (opts.model?.includes('|') ? opts.model.split('|').slice(1).join('|') : '')

    /**
     * Denk-stufe: erst die eigene Vorgabe für dieses Modell, dann die allgemeine.
     * „Automatik" sendet nichts — das Modell entscheidet selbst. Ob das Modell
     * denken kann, wird nachgesehen, weil die Schnittstelle das Feld bei
     * Modellen ohne Denken ablehnt statt zu ignorieren.
     */
    let faehigkeit: boolean | undefined
    try {
      const modelle = await this.registry.models()
      faehigkeit = modelle.some((m) => `${m.providerId}|${m.id}` === bezug && m.capabilities.thinking === true)
    } catch {
      faehigkeit = undefined
    }
    const denk = denkRegel({
      bezug,
      reasoning: this.settings.get().reasoning,
      vorgabe: this.settings.get().effort,
      faehigkeit
    })

    // Protokoll einmal aufbauen und über alle Schritte fortschreiben.
    // Der eigene Zweig, von dieser Antwort aus — nicht das aktuelle Blatt des
    // Chats: Das kann sich während des Laufs ändern (Fassung gewechselt, zweite
    // Anfrage vom Handy), und das Modell bekäme ein fremdes Gespräch.
    const history = this.store.pfadBis(assistantMessage.id).filter((m) => m.id !== assistantMessage.id)
    const run = new Run(
      assistantMessage,
      toLlmMessages(chat, history, Boolean(opts.tools), this.zusatzFuer(chat, opts)),
      this.store,
      emit,
      streamId,
      chat.id
    )

    try {
      const maxSteps = opts.tools?.maxSteps ?? MAX_TOOL_STEPS_DEFAULT

      if (opts.tiefenrecherche) {
        const beginn = Date.now()
        // Planen und Auswerten fragen dasselbe Modell, ohne Denken und ohne
        // Werkzeuge: kurz und sachlich, sonst dauert jede Quelle Minuten.
        // „Nicht denken“ wird immer mitgeschickt: Die Erkennung, ob ein Modell
        // denken kann, ist unsicher — und ein Modell, das hier nachdenkt, verbraucht
        // sein Antwortlimit fürs Denken und liefert keinen Text. Wer das Feld nicht
        // kennt, bekommt die Anfrage vom Anbieter automatisch ohne es.
        const fragModell: ModellFrage = async (system, nutzer, o) => {
          const frag = async (maxTokens: number): Promise<string> => {
            let text = ''
            await resolved.client.generate(
              {
                model,
                messages: [
                  { role: 'system', content: system },
                  { role: 'user', content: nutzer }
                ],
                thinking: 'off',
                supportsThinking: true,
                maxTokens
              },
              { onText: (t) => (text += t) },
              o?.signal ?? controller.signal
            )
            return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
          }
          const grenze = o?.maxTokens ?? 800
          // Dachte es doch nach und kam nicht zum Antworten: einmal mit mehr Raum.
          return (await frag(grenze)) || (await frag(grenze + 3000))
        }
        const schritte = run.schritte()
        const hauptId = schritte.beginn('tiefenrecherche', { frage: opts.text })
        let ok = true
        let grundlage: string
        try {
          const ergebnis = await tiefenrecherche(opts.text, { fragModell, schritte, signal: controller.signal })
          grundlage = tiefGrundlage(ergebnis)
          schritte.ende(hauptId, 'tiefenrecherche', true, grundlage)
          log.info('Tiefenrecherche', { chatId: chat.id, suchen: ergebnis.suchen, seiten: ergebnis.gelesen, quellen: ergebnis.quellen.length, ms: Date.now() - beginn })
        } catch (e) {
          if ((e as Error).name === 'AbortError' || controller.signal.aborted) throw e
          ok = false
          grundlage = `Tiefenrecherche gescheitert: ${(e as Error).message}`
          schritte.ende(hauptId, 'tiefenrecherche', false, grundlage)
        }
        run.vorabErgebnis({ id: hauptId, name: 'tiefenrecherche', args: { frage: opts.text } }, ok, grundlage, Boolean(opts.tools))
        run.pause(Date.now() - beginn)
      }

      const stufe = opts.effort ?? denk.thinking
      const budget = denk.supportsThinking || resolved.client.kind !== 'ollama' ? denkBudget(stufe) : undefined

      for (let step = 0; ; step++) {
        const calls: ToolCall[] = []
        const anfrage: GenerateRequest = {
          model,
          messages: run.protocolMessages(),
          tools: opts.tools?.specs,
          thinking: stufe,
          supportsThinking: denk.supportsThinking,
          maxTokens: antwortRaum(stufe)
        }
        const griffe = run.handlersFor(calls)

        /*
         * Denkbudget: Der Schritt hat eine eigene Abbruchleine, die am Lauf
         * hängt. Denkt das Modell über sein Budget hinaus, bevor es antwortet,
         * wird nur dieser Schritt gekappt — und ohne Denken neu gefragt, mit den
         * bisherigen Überlegungen als Notiz. So greift die Stufe bei jedem Modell.
         */
        const schritt = new AbortController()
        const mitAbbrechen = (): void => schritt.abort()
        controller.signal.addEventListener('abort', mitAbbrechen)
        let gedacht = ''
        let geantwortet = false
        let gekappt = false
        const mitBudget: GenerateHandlers = {
          ...griffe,
          onText: (text) => {
            geantwortet = true
            griffe.onText?.(text)
          },
          onToolCall: (call) => {
            geantwortet = true
            griffe.onToolCall?.(call)
          },
          onThinking: (text) => {
            if (gekappt) return
            gedacht += text
            griffe.onThinking?.(text)
            if (budget !== undefined && !geantwortet && gedacht.length > budget) {
              gekappt = true
              schritt.abort()
            }
          }
        }
        let result: Awaited<ReturnType<typeof resolved.client.generate>>
        try {
          result = await resolved.client.generate(anfrage, mitBudget, schritt.signal)
        } catch (fehler) {
          if (!gekappt || controller.signal.aborted) throw fehler
          result = { stopReason: 'canceled' }
        } finally {
          controller.signal.removeEventListener('abort', mitAbbrechen)
        }
        if (gekappt) run.anfrageGeschaetzt(gedacht.length)
        else run.anfrageFertig()
        if (gekappt && !controller.signal.aborted) {
          log.info('Denkbudget erreicht', { chatId: chat.id, stufe, zeichen: gedacht.length })
          griffe.onThinking?.(`\n\n— Denkbudget „${stufe}“ erreicht, Antwort ohne weiteres Nachdenken —`)
          calls.length = 0
          result = await resolved.client.generate(
            {
              ...anfrage,
              thinking: 'off',
              messages: [
                ...anfrage.messages,
                {
                  role: 'user',
                  content:
                    `Deine bisherigen Überlegungen (hier abgebrochen, Aufwand „${stufe}“):\n${gedacht}\n\n` +
                    'Hör jetzt auf nachzudenken und beantworte die ursprüngliche Anfrage direkt.'
                }
              ]
            },
            // Denkt ein Modell trotz „aus“ weiter (gpt-oss kann nicht anders), wird das nicht mehr gezeigt.
            { ...griffe, onThinking: undefined },
            controller.signal
          )
          run.anfrageFertig()
        }
        const wantsTools = result.stopReason === 'tool_calls' && calls.length > 0 && Boolean(opts.tools)
        run.recordAssistantTurn(wantsTools ? calls : [])

        if (!wantsTools || controller.signal.aborted) break
        if (step >= maxSteps) {
          log.warn('Werkzeugschritte limitiert', { chatId: chat.id, steps: step })
          // Nicht stumm aufhören: sagen, warum hier Schluss ist und wie es weitergeht.
          run.handlersFor([]).onText?.(`\n\n*Hier halte ich an: Die Grenze von ${maxSteps} Werkzeugschritten ist erreicht. Schreib „weiter“, dann mache ich an dieser Stelle weiter.*`)
          break
        }

        const werkzeugBeginn = Date.now()
        for (const call of calls) {
          let ok = false
          let output = ''
          let document: DocumentRef | undefined
          try {
            const executed = await opts.tools!.execute(call.id, call.name, call.args)
            ok = executed.ok
            output = executed.output
            document = executed.document
          } catch (e) {
            ok = false
            output = (e as Error).message
          }
          run.recordToolResult(call, ok, output, document)
          emit({
            streamId,
            type: 'tool_result',
            chatId: chat.id,
            messageId: assistantMessage.id,
            callId: call.id,
            tool: call.name,
            ok,
            preview: output.slice(0, 2000)
          })
          if (ok && document) {
            emit({
              streamId,
              type: 'document',
              chatId: chat.id,
              messageId: assistantMessage.id,
              path: document.path,
              kind: document.kind,
              title: document.title,
              bytes: document.bytes
            })
          }
        }
        run.pause(Date.now() - werkzeugBeginn)
      }

      run.finish()
      emit({ streamId, type: 'done', chatId: chat.id, messageId: assistantMessage.id })
    } catch (e) {
      const err = e as Error
      if (err.name === 'AbortError' || controller.signal.aborted) {
        run.finish()
        emit({ streamId, type: 'done', chatId: chat.id, messageId: assistantMessage.id })
      } else {
        log.error('Lauf fehlgeschlagen', `${err.message} :: ${opts.model ?? 'kein Modell'}`)
        fehlertext = err.message
        run.finish(err.message)
        emit({ streamId, type: 'error', chatId: chat.id, messageId: assistantMessage.id, message: err.message })
      }
    } finally {
      anfrageEndet()
      // Wer die Antwort woanders erwartet, kriegt eine Meldung — aber nur, wenn
      // das Fenster gerade nicht im Vordergrund steht. Sonst meldet die App
      // etwas, das man gerade liest.
      // Titel des Gesprächs, darunter der Anfang der Antwort.
      // Der Titel wird frisch gelesen — er entsteht erst während des Laufs.
      const gestoppt = controller.signal.aborted
      if (!opts.stumm && !gestoppt && !BrowserWindow.getAllWindows().some((fenster) => !fenster.isDestroyed() && fenster.isFocused())) {
        const titel = (!this.store.isClosed && this.store.getChat(chat.id)?.title) || chat.title || 'Antwort'
        const anfang = run.vorschau()
        benachrichtige({
          titel,
          text: fehlertext ? `Lief fehlerhaft: ${fehlertext}` : anfang || 'Die Antwort ist fertig.',
          fehler: Boolean(fehlertext),
          chatId: chat.id
        })
      }
      this.active.delete(streamId)
      this.chatOf.delete(streamId)
      log.info('Lauf beendet', { chatId: chat.id, ms: Date.now() - startedAt })
      try {
        this.store.touchChat(chat.id, { model: opts.model ?? chat.model })
      } catch {
        /* Datenbank bereits geschlossen */
      }
    }

    return { streamId }
  }
}
