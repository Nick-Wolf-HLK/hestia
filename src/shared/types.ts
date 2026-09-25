import type { Schedule } from './schedule'

/** Domain-Typen, die Main- und Renderer-Prozess teilen. */

export type ChatMode = 'chat' | 'agent'

export type Role = 'user' | 'assistant' | 'system'

/** Ein Inhaltsteil einer Nachricht. Bewusst flach gehalten (kein Anbieterformat). */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'image'; mediaType: string; dataBase64: string; name?: string }
  | { type: 'file'; name: string; mediaType: string; text: string }
  | { type: 'tool_call'; id: string; tool: string; args: unknown }
  | { type: 'tool_result'; id: string; tool: string; ok: boolean; output: string }
  | { type: 'document'; path: string; kind: DocumentKind; title: string; bytes?: number }
  | ({ type: 'metrics' } & MessageMetrics)

/**
 * Durchsatz eines Laufs. Die Tokenzahl kommt vom Anbieter (exakt); meldet er
 * sie nicht, wird sie aus der Textlänge geschätzt und entsprechend markiert.
 */
export interface MessageMetrics {
  /** Erzeugte Token. */
  outputTokens: number
  /** Aufgenommene Token, falls der Anbieter sie meldet. */
  inputTokens?: number
  /** Laufzeit von Absenden bis fertige Antwort in Millisekunden. */
  durationMs: number
  /** Erzeugte Token pro Sekunde, auf eine Nachkommastelle gerundet. */
  perSecond: number
  /** Wahr, wenn die Tokenzahl geschätzt statt gemeldet wurde. */
  estimated: boolean
}

export interface Message {
  id: string
  chatId: string
  role: Role
  parts: ContentPart[]
  createdAt: number
  /** Token-Zählerstand, falls der Anbieter ihn liefert. */
  usage?: { input?: number; output?: number }
  error?: string
  /** Vorgängerin im Gesprächsbaum (leer: erste Nachricht). */
  parentId?: string
  /** Welche von wie vielen Fassungen an dieser Stelle (‹ 2/3 ›). */
  zweig?: Zweig
}

/** Stelle einer Nachricht unter ihren Schwestern, 1-basiert. */
export interface Zweig {
  index: number
  anzahl: number
}

/**
 * Wie viel sich der Agent in einem Chat nehmen darf:
 * `ask` fragt vor jeder Änderung, `autoWrites` schreibt still im Arbeitsordner
 * (Kommandos fragen weiter), `everything` fragt gar nicht mehr.
 */
/**
 * Denkstufe für Modelle, die denken können.
 *
 * `auto` heißt: gar nichts senden — das Modell entscheidet selbst. Das ist ein
 * anderer Zustand als `off`, wo dem Modell ausdrücklich abgesagt wird.
 */
export type ReasoningChoice = 'auto' | 'off' | 'low' | 'medium' | 'high'

export type PermissionMode = 'ask' | 'autoWrites' | 'everything'

export interface Chat {
  id: string
  title: string
  mode: ChatMode
  /** Fehlt der Wert, gilt `ask` — die sichere Stufe. */
  permissionMode?: PermissionMode
  projectId?: string
  /** Im Agent-Modus: der Ordner, in dem gearbeitet werden darf. */
  folder?: string
  pinned: boolean
  createdAt: number
  updatedAt: number
  model?: string
}

/** Ein Skill im offenen SKILL.md-Format: Ordner mit SKILL.md (Kopf + Anleitung). */
export interface Skill {
  /** Zugleich der Ordnername; Kleinbuchstaben, Ziffern, Bindestriche. */
  name: string
  /** Wann der Skill passt — das Modell entscheidet daran. */
  description: string
  /** Die Anleitung selbst (Markdown). */
  body: string
  enabled: boolean
  path: string
  updatedAt: number
}

export interface Project {
  id: string
  name: string
  folder?: string
  /** Vorgabe für Chats, die in diesem Projekt anfangen. */
  permissionMode?: PermissionMode
  instructions?: string
  pinned: boolean
  createdAt: number
  updatedAt: number
}

/**
 * Eine Erinnerung — ein einzelner, bearbeitbarer Eintrag im Gedächtnis.
 *
 * Es gibt getrennte Speicher: einen allgemeinen für Chats
 * außerhalb von Projekten (`projectId` fehlt) und einen je Projekt. Ein
 * Projekt lernt nur aus seinen eigenen Chats.
 */
export interface Erinnerung {
  id: string
  projectId?: string
  /** Kurzes Thema zum Gruppieren, z. B. „Beruf“ oder „Vorlieben“. */
  thema: string
  text: string
  /** Aus welchem Chat sie stammt (leer: von Hand angelegt). */
  chatId?: string
  createdAt: number
  updatedAt: number
}

/** Eine Datei im Projekt-Kontext (ohne ihren Text — der bleibt im Hauptprozess). */
export interface ProjektDatei {
  id: string
  projectId: string
  name: string
  /** Kurzform für die Kachel: PDF, DOCX, MD, TXT … */
  art: string
  groesse: number
  /** Länge des gelesenen Textes; 0 heißt: nichts Lesbares gefunden. */
  zeichen: number
  createdAt: number
}

/** Stand des Projekt-Kontexts für die Anzeige. */
export interface ProjektKontext {
  dateien: ProjektDatei[]
  /** Summe aller gelesenen Zeichen. */
  zeichen: number
  /** Obergrenze des Projekts in Zeichen. */
  kapazitaet: number
  /** Bis zu dieser Summe geht alles komplett in den Prompt, darüber wird gesucht. */
  vollstaendigBis: number
  suchmodus: boolean
}

/**
 * Ein geplanter Auftrag: ein Auftrag, den die App von allein startet.
 * `lastChatId` verbindet die Ausführung mit dem Chat, in dem sie gelaufen ist.
 */
export interface PlannedTask {
  id: string
  title: string
  /** Der Auftragstext, so wie er gestellt würde. */
  prompt: string
  mode: ChatMode
  folder?: string
  model?: string
  /** Läuft im Projekt: sein Kontext und sein Gedächtnis gelten. */
  projectId?: string
  schedule: Schedule
  enabled: boolean
  /** Der nächste Lauf; 0 heißt: kein weiterer (einmalig und erledigt). */
  nextRunAt: number
  lastRunAt?: number
  lastChatId?: string
  lastError?: string
  createdAt: number
  updatedAt: number
}

export type ProviderKind = 'ollama' | 'openai' | 'llama'

export interface ProviderConfig {
  id: string
  label: string
  kind: ProviderKind
  /** Basis-URL ohne Pfad, z. B. http://127.0.0.1:11434 */
  baseUrl: string
  /** Nur für Anbieter nötig; sicher in safeStorage abgelegt. */
  hasKey: boolean
  enabled: boolean
}

export interface ModelInfo {
  providerId: string
  /** ID, mit der der Anbieter angesprochen wird. */
  id: string
  /** Anzeigename im Modellmenü. */
  label: string
  capabilities: {
    tools: boolean
    thinking: boolean
    vision: boolean
  }
  contextLength?: number
  sizeBytes?: number
}

export type TaskStatus = 'queued' | 'running' | 'needs_permission' | 'done' | 'failed' | 'canceled'

/** Ereignis eines laufenden Chat-/Agent-Durchlaufs (Main → Renderer). */
export type StreamEvent =
  | {
      streamId: string
      type: 'start'
      chatId: string
      messageId: string
      /** Fassungszähler der neuen Antwort (nach „neu erzeugen“ z. B. 2/2). */
      zweig?: Zweig
      /** Die eben gespeicherte Frage — sonst sieht man im Verlauf nur die Antwort. */
      userMessage?: Message
    }
  | { streamId: string; type: 'delta_text'; chatId: string; messageId: string; text: string }
  | { streamId: string; type: 'delta_thinking'; chatId: string; messageId: string; text: string }
  | {
      streamId: string
      type: 'tool_call'
      chatId: string
      messageId: string
      callId: string
      tool: string
      args: unknown
    }
  | {
      streamId: string
      type: 'tool_result'
      chatId: string
      messageId: string
      callId: string
      tool: string
      ok: boolean
      preview: string
    }
  | {
      streamId: string
      type: 'document'
      chatId: string
      messageId: string
      path: string
      kind: DocumentKind
      title: string
      bytes?: number
    }
  | ({ streamId: string; type: 'usage'; chatId: string; messageId: string; input?: number; output?: number } &
      Partial<MessageMetrics>)
  | { streamId: string; type: 'done'; chatId: string; messageId: string }
  | { streamId: string; type: 'error'; chatId: string; messageId: string; message: string }

/** Was das Vorschau-Panel für eine Datei bekommt. */
export type PreviewKind = 'markdown' | 'text' | 'pdf' | 'docx' | 'image' | 'unsupported'

export interface MarkdownPreview { kind: 'markdown'; path: string; text: string; truncated: boolean }
export interface TextPreview { kind: 'text'; path: string; text: string; truncated: boolean }
export interface PdfPreview { kind: 'pdf'; path: string; base64: string; bytes: number }
export interface DocxPreview { kind: 'docx'; path: string; base64: string; bytes: number }
export interface ImagePreview { kind: 'image'; path: string; base64: string; mediaType: string; bytes: number }
export interface UnsupportedPreview { kind: 'unsupported'; path: string; reason: string }

export type PreviewPayload =
  | MarkdownPreview
  | TextPreview
  | PdfPreview
  | DocxPreview
  | ImagePreview
  | UnsupportedPreview

export type ThemeMode = 'light' | 'dark' | 'system'
export type Language = 'de' | 'en'

export interface Settings {
  displayName: string
  language: Language
  theme: ThemeMode
  startView: 'home' | 'lastChat'
  defaultModelChat?: string
  defaultModelAgent?: string
  /** Welches Modell ein neuer Chat bekommt: das zuletzt benutzte oder ein festes. */
  modellBeimStart: 'zuletzt' | 'fest'
  /** Das Modell, mit dem zuletzt gesendet wurde (`anbieter|modell`). */
  zuletztModell: string
  /** Denkstufe, falls das Modell sie unterstützt. */
  effort: ReasoningChoice
  /**
   * Denkstufe je Modellbezug (`anbieter|modell`). Fehlt der Eintrag, gilt `effort`
   * darüber als Vorgabe für alle Modelle.
   */
  reasoning: Record<string, ReasoningChoice>
  /** Erlaubt Agent Schreibzugriff ohne Rückfrage innerhalb des Ordners. */
  autoApproveWrites: boolean
  /** Erlaubt Kommando-Ausführung (grundsätzlich mit Rückfrage). */
  allowCommands: boolean
  minimizeToTray: boolean
  keepAwake: boolean
  /** Fernzugang (Handy/MacBook) war an — er geht mit der App wieder an. */
  fernzugangAn: boolean
  /** Die Modelle, die im Eingabefeld zur Wahl stehen (höchstens fünf). Leer: die zuletzt genutzten. */
  modellauswahl: string[]
  /** Gedächtnis: Erinnerungen lesen und vom Modell anlegen lassen. */
  gedaechtnisAn: boolean
  /** Gesundheit, Religion, politische Ansichten u. Ä. dürfen ins Gedächtnis (Vorgabe: nein). */
  gedaechtnisSensibel: boolean
  /** Frühere Chats durchsuchen und darauf verweisen (Werkzeuge chats_durchsuchen, letzte_chats). */
  chatsDurchsuchen: boolean
  /** Pfad zum Erkennungsprogramm; leer heißt: selbst suchen. */
  /** Schriftgröße in Prozent der Vorgabe (80–160). */
  schriftstufe: number
  diktierProgramm: string
  /** Pfad zum Modell (`.gguf`); leer heißt: in den üblichen Ordnern suchen. */
  diktierModell: string
  /** Letzter Chats-Modus, damit der Composer so startet. */
  /** Breite des Vorschau-Panels rechts (px). */
  panelWidth: number
  /** Vorschau als Quelltext statt gerendert. */
  panelSourceView: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  displayName: '',
  language: 'de',
  theme: 'system',
  startView: 'home',
  // Beide standen nur in der Typvereinbarung, nie in den Vorgaben: ein Feld
  // ohne Vorgabe ist beim ersten Start nicht vorhanden — und fiel damit durch
  // jeden Raster, der die Vorgaben als Maß nimmt.
  defaultModelChat: '',
  defaultModelAgent: '',
  modellBeimStart: 'zuletzt',
  zuletztModell: '',
  effort: 'auto',
  reasoning: {},
  autoApproveWrites: false,
  allowCommands: false,
  minimizeToTray: true,
  keepAwake: false,
  fernzugangAn: false,
  modellauswahl: [],
  gedaechtnisAn: true,
  gedaechtnisSensibel: false,
  chatsDurchsuchen: true,
  schriftstufe: 100,
  diktierProgramm: '',
  diktierModell: '',
  panelWidth: 520,
  panelSourceView: false
}

export interface BootstrapPayload {
  branding: {
    name: string
    shortName: string
    tagline: string
    accent: { light: string; dark: string }
    copyright: string
    webseite: string
    quellcode: string
  }
  settings: Settings
  chats: Chat[]
  projects: Project[]
  providers: ProviderConfig[]
  /** Aufgelöste System-Beleuchtung, damit der erste Frame passt. */
  prefersDark: boolean
  platform: NodeJS.Platform
  keychainAvailable: boolean
  /** Nur für automatisierte Prüfläufe (HESTIA_AUTO_*-Umgebungsvariablen). */
  autoPrompt?: string
  autoMode?: 'chat' | 'agent'
  autoFolder?: string
  autoApprove?: boolean
}

export type PermissionKind = 'write' | 'command'

/** Anfrage des Agenten an den Menschen, bevor etwas geändert wird. */
export interface PermissionRequest {
  id: string
  chatId: string
  kind: PermissionKind
  /** Betroffener Pfad bzw. auszuführendes Kommando. */
  target: string
  /** Kurze Vorschau (Diff-Auszug, Arbeitsordner). */
  detail: string
}

export interface PermissionDecision {
  id: string
  allowed: boolean
  /** Gleiche Anfrage innerhalb dieses Laufs nicht erneut stellen. */
  remember?: boolean
}

/** Dateiformate, die die App selbst erzeugen kann. */
export type DocumentKind = 'markdown' | 'docx' | 'pdf'

/** Ein von der App oder dem Agenten erzeugtes Dokument. */
export interface DocumentRef {
  path: string
  kind: DocumentKind
  title: string
  bytes?: number
}

/** Vorgabe für das Vorschau-Panel rechts. */
export interface PanelTarget {
  path: string
  title: string
  /** Zählt hoch, wenn dieselbe Datei neu geschrieben wurde — die Vorschau lädt dann nach. */
  stand?: number
}

export type ArtifactKind = 'markdown' | 'html' | 'svg' | 'code' | 'text'

/** Aus einem Chat gespeicherter, eigenständiger Inhalt. */
export interface Artifact {
  id: string
  title: string
  kind: ArtifactKind
  body: string
  chatId?: string
  pinned: boolean
  createdAt: number
  updatedAt: number
}

/** Zustand des Handy-Zugangs. */
export interface MobileStatus {
  running: boolean
  /** Adresse für das Handy, inklusive Zugangsstand. */
  url?: string
  /** QR-Code als eingebettetes Bild. */
  qr?: string
  port?: number
  /** Angemeldete Geräte, die gerade zuhören. */
  clients?: number
  /** Gefundene Netzadressen, falls die erste nicht erreichbar ist. */
  addresses?: string[]
  /** https-Adresse über Tailscale, falls eingerichtet: auch unterwegs, als App ohne Browserleisten, mit Mikrofon. */
  sicher?: string
  sicherQr?: string
  lastError?: string
}

