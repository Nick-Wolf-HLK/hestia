/** App-Bootstrap: Einzelinstanz, Dienste, Fenster, Tray. */
import { app, BrowserWindow, Menu, nativeImage, nativeTheme, Tray } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { branding } from '@shared/branding'
import { Store } from './db'
import { SettingsService } from './settings'
import { ProviderRegistry } from './providers'
import { ChatRunner } from './chat'
import { registerIpc, shutdownMobile, startScheduler, stopScheduler } from './ipc'
import { PermissionBroker } from './agent/permissions'
import { createMainWindow } from './windows'
import { log } from './logger'

let store: Store | undefined
let settings: SettingsService | undefined
let runner: ChatRunner | undefined
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  bootstrap().catch((err) => {
    log.error('Bootstrap fehlgeschlagen', String(err))
    process.exitCode = 1
  })
}

async function bootstrap(): Promise<void> {
  app.setName(branding.shortName)
  app.setAppUserModelId(branding.appId)

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' }
    ])
  )

  await app.whenReady()

  store = Store.open()
  settings = new SettingsService(store)
  const registry = new ProviderRegistry(store, settings)
  runner = new ChatRunner(store, registry, settings)

  nativeTheme.themeSource = settings.get().theme

  const permissions = new PermissionBroker(() =>
    BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed()).map((window) => window.webContents)
  )
  runner.beiStop = (chatId) => permissions.cancelFor(chatId)

  registerIpc({
    store,
    settings,
    registry,
    runner,
    permissions,
    getWindow: () => mainWindow
  })

  createWindow()
  setupTray()

  // Der Ablaufverwalter fährt mit, aber erst einen Moment später: Überfällige
  // Aufträge sollen laufen, wenn das Fenster sie auch zeigen kann.
  setTimeout(() => startScheduler(), 3000)

  log.info('App bereit', {
    version: app.getVersion(),
    platform: process.platform,
    userData: app.getPath('userData')
  })

  app.on('activate', () => {
    if (!mainWindow) createWindow()
    else mainWindow.show()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    isQuitting = true
    stopScheduler()
    // Der Handy-Zugang geht zuerst: ein lauschender Dienst soll nicht übrig
    // bleiben, nur weil das Fenster schon zu war.
    shutdownMobile()
    runner?.stopAll()
    store?.close()
  })
}

function createWindow(): void {
  if (!store) return
  mainWindow = createMainWindow(store)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  // In die Ablage statt schließen — außer die App will wirklich beenden.
  mainWindow.on('close', (event) => {
    if (isQuitting || !tray || !settings?.get().minimizeToTray) return
    event.preventDefault()
    mainWindow?.hide()
  })
}

function setupTray(): void {
  if (!settings?.get().minimizeToTray) return
  const candidates = [
    join(process.resourcesPath ?? '', 'build', 'icons', 'tray.png'),
    join(app.getAppPath(), 'build', 'icons', 'tray.png')
  ]
  const path = candidates.find((candidate) => existsSync(candidate))
  if (!path) {
    log.info('Kein Ablagen-Symbol gefunden, Ablage wird übersprungen')
    return
  }
  try {
    const image = nativeImage.createFromPath(path)
    if (image.isEmpty()) return
    tray = new Tray(image.resize({ width: 22, height: 22 }))
    tray.setToolTip(branding.name)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Fenster anzeigen',
          click: () => {
            mainWindow?.show()
            mainWindow?.focus()
          }
        },
        { type: 'separator' },
        {
          label: 'Beenden',
          click: () => {
            isQuitting = true
            app.quit()
          }
        }
      ])
    )
  } catch (e) {
    // GNOME braucht eine Status-Icon-Erweiterung; Fehlen ist kein Fehler.
    log.warn('Systemablage nicht verfügbar', (e as Error).message)
    tray = null
  }
}
