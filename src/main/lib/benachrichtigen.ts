/**
 * Eine Meldung draußen abliefern — in der Benachrichtigungszeile des
 * Rechners, nicht in der App.
 *
 * Der Anlaß ist fast immer ein geplanter Auftrag, der lange läuft und fertig
 * ist, während jemand anderes arbeitet. Deshalb gilt:
 *
 - die Meldung kommt nur für die **Ergebnisse**, nicht für jeden Schritt;
 *   sonst hört niemand nach zwei Tagen noch hin.
 * - ein Klick holt das Fenster zurück. Wohin genau, steht unten.
 * - was der Rechner nicht kann, wird nicht verstellt: ohne Unterstützung
 *   bleibt es beim Protokoll, die App tut sonst so, als wäre etwas gemeldet.
 */
import { app, BrowserWindow, nativeImage, Notification, type NativeImage } from 'electron'
import { join } from 'node:path'
import { Channels } from '@shared/ipc'
import { log } from '../logger'

export interface Meldung {
  titel: string
  text: string
  /** Ein Fehler läuft anders mit: er ist laut, damit niemand ihn übersieht. */
  fehler?: boolean
  /** Gespräch, das ein Klick auf die Meldung öffnet. */
  chatId?: string
}

/**
 * Das App-Symbol für die Meldung. Ohne Symbol zeigt GNOME ein allgemeines
 * Zahnrad — dann erkennt niemand auf einen Blick, von wem die Meldung kommt.
 */
let symbol: NativeImage | undefined | null = null
function appSymbol(): NativeImage | undefined {
  if (symbol !== null) return symbol
  const kandidaten = [
    join(app.getAppPath(), 'build', 'icons', '256x256.png'),
    join(process.resourcesPath ?? '', 'build', 'icons', '256x256.png')
  ]
  symbol = undefined
  for (const pfad of kandidaten) {
    const bild = nativeImage.createFromPath(pfad)
    if (!bild.isEmpty()) {
      symbol = bild
      break
    }
  }
  return symbol
}

/** Leistet dieser Rechner Meldungen? Einmal gefragt, nie wieder. */
let kann: boolean | null = null

function unterstuetzt(): boolean {
  if (kann === null) {
    try {
      kann = Notification.isSupported()
    } catch {
      kann = false
    }
    if (!kann) log.warn('Benachrichtigungen: dieser Rechner leistet keine — Meldungen bleiben im Protokoll')
  }
  return kann
}

/**
 * Die Meldung absetzen. Sie schlägt nie fehl: was hier schiefgeht, darf einen
 * laufenden Auftrag nicht aufhalten.
 */
export function benachrichtige(meldung: Meldung): void {
  if (!unterstuetzt()) return
  try {
    const zeiger = new Notification({
      title: meldung.fehler ? `Fehler: ${meldung.titel}` : meldung.titel,
      // Zwei Zeilen reichen; mehr zeigt die Zeile meist nicht an.
      body: meldung.text.length > 180 ? `${meldung.text.slice(0, 177)}…` : meldung.text,
      icon: appSymbol(),
      silent: false
    })
    // Ein Klick holt das Fenster zurück und öffnet das Gespräch, um das es geht.
    zeiger.on('click', () => {
      const fenster = BrowserWindow.getAllWindows()[0]
      if (!fenster) return
      if (fenster.isMinimized()) fenster.restore()
      fenster.show()
      fenster.focus()
      if (meldung.chatId && !fenster.webContents.isDestroyed()) fenster.webContents.send(Channels.openChatRequest, meldung.chatId)
    })
    zeiger.show()
  } catch (fehler) {
    log.warn('Benachrichtigung kam nicht an', fehler instanceof Error ? fehler.message : String(fehler))
  }
}
