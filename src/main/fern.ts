/**
 * Die Vermittlung zum Browser: dieselben Kanäle, dieselben Ereignisse.
 *
 * Die Oberfläche am Rechner spricht über Electrons Kanäle mit dem
 * Hauptprogramm. Über den Fernzugang läuft **dieselbe** Oberfläche im Browser;
 * damit sie dasselbe kann, liegen hier die Empfänger aller Kanäle ein zweites
 * Mal bereit, und alles, was das Hauptprogramm dem Fenster schickt, geht auch
 * an die verbundenen Browser.
 */
import { Channels } from '@shared/ipc'

type Empfaenger = (eingabe: unknown) => unknown
type Hoerer = (kanal: string, werte: unknown[]) => void

const empfaenger = new Map<string, Empfaenger>()
const einseitig = new Map<string, (eingabe: unknown) => void>()
const hoerer = new Set<Hoerer>()

/**
 * Was im Browser nicht dasselbe tun darf wie am Rechner: Fenstersteuerung,
 * Dialoge und „Öffnen/Zeigen“ würden **auf dem Rechner** aufgehen, nicht auf
 * dem Gerät, das fragt. Die Oberfläche im Browser löst das selbst (Download,
 * eigene Eingabe, eigene Zwischenablage).
 */
export const NUR_AM_RECHNER = new Set<string>([
  Channels.winClose,
  Channels.winMinimize,
  Channels.winToggleMaximize,
  Channels.winIsMaximized,
  Channels.folderPick,
  Channels.revealPath,
  Channels.copyText,
  Channels.skillsImport,
  Channels.skillsReveal,
  Channels.documentsOpen,
  Channels.documentsReveal,
  Channels.documentsSaveAs,
  Channels.artifactsExport,
  // Ausschalten oder neuen Code erzeugen sägt den Ast ab, auf dem das Gerät
  // sitzt — und ein verlorenes Handy soll dich nicht aussperren können.
  Channels.mobileStop,
  Channels.mobileNewCode,
  // Anbieter ändern hieße: alle Gespräche an einen fremden Server umleiten.
  Channels.providersSave,
  Channels.providersDelete
])

/**
 * Einstellungen, die aus der Ferne nicht zu ändern sind: Diktierprogramm und
 * -modell starten ein Programm auf dem Rechner, die Freigaben heben die
 * Rückfragen vor Schreiben und Befehlen auf. Das entscheidet man am Rechner.
 */
const NUR_AM_RECHNER_EINSTELLUNGEN = ['diktierProgramm', 'diktierModell', 'autoApproveWrites', 'allowCommands', 'fernzugangAn']

/** Prüft, ob ein Ordner schon als Arbeitsordner bekannt ist (von ipc.ts gesetzt). */
let bekannterOrdner: (ordner: string) => boolean = () => false
export function fernOrdnerPruefer(pruefer: (ordner: string) => boolean): void {
  bekannterOrdner = pruefer
}

/** Was aus der Ferne ankommt, auf das Erlaubte zurechtstutzen. */
function fernEingabe(kanal: string, eingabe: unknown): unknown {
  if (kanal === Channels.settingsSet && eingabe && typeof eingabe === 'object') {
    const rest = { ...(eingabe as Record<string, unknown>) }
    for (const schluessel of NUR_AM_RECHNER_EINSTELLUNGEN) delete rest[schluessel]
    return rest
  }
  // Ein neuer Arbeitsordner wird am Rechner gewählt; aus der Ferne nur einer,
  // den es schon gibt — sonst würde jeder Ordner zur freigegebenen Wurzel.
  if ((kanal === Channels.chatCreate || kanal === Channels.chatSetMode) && eingabe && typeof eingabe === 'object') {
    const ordner = (eingabe as { folder?: unknown }).folder
    if (typeof ordner === 'string' && ordner && !bekannterOrdner(ordner)) {
      throw new Error('Einen neuen Arbeitsordner bitte am Rechner wählen.')
    }
  }
  return eingabe
}

/** Wird von `handle()` in ipc.ts für jeden Kanal gerufen. */
export function fernEmpfaenger(kanal: string, tun: Empfaenger): void {
  empfaenger.set(kanal, tun)
}

/** Für die wenigen Kanäle, die nur senden (Freigabe beantworten). */
export function fernEinseitig(kanal: string, tun: (eingabe: unknown) => void): void {
  einseitig.set(kanal, tun)
}

export async function fernAufruf(kanal: string, eingabe: unknown): Promise<unknown> {
  if (NUR_AM_RECHNER.has(kanal)) throw new Error('Das geht nur am Rechner selbst.')
  const tun = empfaenger.get(kanal)
  if (!tun) throw new Error(`Unbekannter Kanal: ${kanal}`)
  return tun(fernEingabe(kanal, eingabe))
}

export function fernSenden(kanal: string, eingabe: unknown): void {
  const tun = einseitig.get(kanal)
  if (!tun) throw new Error(`Unbekannter Kanal: ${kanal}`)
  tun(eingabe)
}

/** Alles, was ans Fenster geht, geht auch an die Browser. */
export function fernRundruf(kanal: string, werte: unknown[]): void {
  for (const h of hoerer) {
    try {
      h(kanal, werte)
    } catch {
      /* ein abgerissener Browser darf die anderen nicht stören */
    }
  }
}

export function fernHoeren(h: Hoerer): () => void {
  hoerer.add(h)
  return () => hoerer.delete(h)
}

/** Nur für Prüfungen: Stand zurücksetzen. */
export function fernLeeren(): void {
  empfaenger.clear()
  einseitig.clear()
  hoerer.clear()
}
