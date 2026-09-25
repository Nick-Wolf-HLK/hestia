/** Hauptfenster: rahmenlos mit eigener Titelleiste, Größe wird gemerkt. */
import { app, BrowserWindow, screen, session, shell, type Session, type WebContents } from 'electron'
import { join } from 'node:path'
import { Channels, type WindowState } from '@shared/ipc'
import { branding } from '@shared/branding'
import type { Store } from './db'
import { log } from './logger'
import { fernRundruf } from './fern'

const BOUNDS_KEY = 'windowBounds'

interface Bounds {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

function withinSomeDisplay(bounds: Bounds): boolean {
  if (bounds.x === undefined || bounds.y === undefined) return true
  const displays = screen.getAllDisplays()
  return displays.some(
    (d) =>
      bounds.x! >= d.bounds.x - 40 &&
      bounds.y! >= d.bounds.y - 40 &&
      bounds.x! < d.bounds.x + d.bounds.width + 40 &&
      bounds.y! < d.bounds.y + d.bounds.height + 40
  )
}

/**
 * Das Mikrofon für das Diktat: ohne diese Zusage fragt Chromium nie nach und
 * die Aufnahme bleibt stumm. Nur `media`, nichts anderes; eigene Fenster sind
 * das einzige, was überhaupt fragen darf.
 */
function erlaubnisRegeln(sitzung: Session): void {
  // Nur das Mikrofon fürs Diktat. Kopieren läuft über den Hauptprozess
  // (`shell.copy`), die Seite selbst braucht keine Zwischenablage-Rechte.
  const erlaubt = new Set(['media'])
  sitzung.setPermissionRequestHandler((_inhalt, rechte, antworten) => {
    antworten(erlaubt.has(rechte))
  })
  sitzung.setPermissionCheckHandler((_inhalt, rechte) => erlaubt.has(rechte))
}

export function createMainWindow(store: Store): BrowserWindow {
  const stored = store.getSetting<Bounds>(BOUNDS_KEY)
  const initial: Bounds =
    stored && withinSomeDisplay(stored)
      ? stored
      : { width: 1240, height: 840, x: undefined, y: undefined, maximized: false }

  erlaubnisRegeln(session.defaultSession)
  const win = new BrowserWindow({
    width: Math.max(900, initial.width),
    height: Math.max(600, initial.height),
    x: initial.x,
    y: initial.y,
    minWidth: 880,
    minHeight: 560,
    show: false,
    frame: false,
    backgroundColor: '#FBFAF7',
    title: branding.name,
    // Unter Linux trägt das Fenster sein Symbol selbst (Taskleiste, Alt+Tab);
    // installiert kommt es ohnehin aus dem Starteintrag.
    icon: join(app.getAppPath(), 'build', 'icons', '256x256.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  })

  // Alles, was das Hauptprogramm dem Fenster schickt, geht auch an die
  // Oberflächen im Browser — Antworten, Freigaben, Zeitpläne, alles.
  const anFenster = win.webContents.send.bind(win.webContents)
  win.webContents.send = (kanal: string, ...werte: unknown[]): void => {
    anFenster(kanal, ...werte)
    fernRundruf(kanal, werte)
  }

  if (initial.maximized) win.maximize()

  win.once('ready-to-show', () => {
    // Diagnose: HESTIA_UNSICHTBAR=1 lässt das Fenster verborgen — für Prüfläufe
    // auf dem echten Fenstersystem (der PDF-Satz braucht eins), ohne dass auf
    // dem Bildschirm ein zweites Hestia-Fenster aufgeht.
    if (process.env['HESTIA_UNSICHTBAR'] === '1') return
    win.show()
    win.focus()
  })

  const persist = () => {
    if (store.isClosed) return
    try {
      const bounds = win.getBounds()
      store.setSetting(BOUNDS_KEY, {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: win.isMaximized()
      })
    } catch (e) {
      log.warn('Fenstergröße konnte nicht gesichert werden', (e as Error).message)
    }
  }
  const debounced = debounce(persist, 500)
  win.on('resized', debounced)
  win.on('moved', debounced)
  win.on('close', persist)

  const pushState = () => {
    const state: WindowState = { maximized: win.isMaximized(), fullScreen: win.isFullScreen() }
    win.webContents.send(Channels.winStateChanged, state)
  }
  win.on('maximize', pushState)
  win.on('unmaximize', pushState)
  win.on('enter-full-screen', pushState)
  win.on('leave-full-screen', pushState)

  // Externe Links im System-Browser, neue Fenster verhindern.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Das Fenster zeigt immer die App selbst. Früher genügte „beginnt mit
  // file://“ — ein Link auf eine lokale PDF ersetzte dann die ganze Oberfläche
  // durch den PDF-Betrachter, ohne Weg zurück.
  win.webContents.on('will-navigate', (event, url) => {
    const ohneAnker = (adresse: string): string => adresse.split('#')[0] ?? adresse
    const erlaubt = process.env['ELECTRON_RENDERER_URL']
      ? url.startsWith(process.env['ELECTRON_RENDERER_URL'])
      : ohneAnker(url) === ohneAnker(win.webContents.getURL())
    if (!erlaubt) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Diagnose: HESTIA_SHOT=/pfad/datei.png schreibt einen Fenster-Schnappschuss
  // und beendet die App danach — für automatisierte Sichtprüfungen.
  const shot = process.env['HESTIA_SHOT']
  if (shot) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void win.webContents
          .capturePage()
          .then(async (image) => {
            const { mkdirSync, writeFileSync } = await import('node:fs')
            mkdirSync(join(shot, '..'), { recursive: true })
            writeFileSync(shot, image.toPNG())
            log.info('Schnappschuss geschrieben', shot)
          })
          .catch((err: Error) => log.error('Schnappschuss fehlgeschlagen', err.message))
          .finally(() => app.quit())
      }, Number(process.env['HESTIA_SHOT_DELAY'] ?? 2600))
    })
  }

  return win
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: NodeJS.Timeout | undefined
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(fn, ms)
  }
}

export function focusOrCreate(getWin: () => BrowserWindow | null, create: () => BrowserWindow): BrowserWindow {
  const existing = getWin()
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return existing
  }
  return create()
}

export type { WebContents }
