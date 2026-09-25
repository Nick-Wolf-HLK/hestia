/**
 * Die Oberfläche im Browser — MacBook, Handy — spricht über den Fernzugang.
 *
 * In Electron legt das preload `window.desk` an. Fehlt es, läuft diese Seite in
 * einem gewöhnlichen Browser: dann entsteht `window.desk` hier, aus demselben
 * Bauplan (shared/desk-api), nur über HTTP und eine Ereignisbahn. Was am
 * Rechner einen Dialog oder das Dateisystem öffnen würde, wird hier zum
 * Download, zur eigenen Eingabe oder zur Zwischenablage des Browsers.
 */
import { bauDesk, type Leitung } from '@shared/desk-api'
import type { Artifact } from '@shared/types'

const MERKER = 'hestia-fern-code'

function codeLesen(): string {
  const ausAdresse = new URLSearchParams(location.search).get('token')
  if (ausAdresse) {
    try {
      localStorage.setItem(MERKER, ausAdresse)
    } catch {
      /* privates Fenster: dann eben nur aus der Adresse */
    }
    return ausAdresse
  }
  try {
    return localStorage.getItem(MERKER) ?? ''
  } catch {
    return ''
  }
}

async function post(pfad: string, code: string, koerper: unknown): Promise<unknown> {
  const antwort = await fetch(pfad, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hestia-code': code },
    body: JSON.stringify(koerper)
  })
  const daten = (await antwort.json().catch(() => ({}))) as { wert?: unknown; error?: string }
  if (antwort.status === 401) throw new Error('Der Zugang gilt nicht mehr — am Rechner unter „Remote“ den Code neu scannen.')
  if (!antwort.ok) throw new Error(daten.error ?? `Fehler ${antwort.status}`)
  return daten.wert
}

/** Kopieren ohne sichere Verbindung: navigator.clipboard gibt es über http nicht. */
async function kopieren(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  const feld = document.createElement('textarea')
  feld.value = text
  feld.setAttribute('readonly', '')
  feld.style.position = 'fixed'
  feld.style.opacity = '0'
  document.body.appendChild(feld)
  feld.select()
  const ok = document.execCommand('copy')
  feld.remove()
  if (!ok) throw new Error('Kopieren hat der Browser abgelehnt.')
}

function herunterladen(href: string, name?: string): void {
  const link = document.createElement('a')
  link.href = href
  if (name) link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function fernBruecke(): void {
  if ((window as { desk?: unknown }).desk) return
  const code = codeLesen()

  // Macht die Seite installierbar (Home-Bildschirm ohne Browserleisten). Geht
  // nur über https — über http lehnt der Browser das ab, dann eben ohne.
  if ('serviceWorker' in navigator && window.isSecureContext) {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  }

  // Eine Ereignisbahn für alle Hörer; sie verbindet sich selbst neu.
  const hoerer = new Map<string, Set<(...werte: unknown[]) => void>>()
  const bahn = new EventSource(`/api/ereignisse?token=${encodeURIComponent(code)}`)
  bahn.onmessage = (roh) => {
    try {
      const { kanal, werte } = JSON.parse(roh.data as string) as { kanal: string; werte: unknown[] }
      for (const h of hoerer.get(kanal) ?? []) h(...werte)
    } catch {
      /* ein kaputtes Ereignis überspringen */
    }
  }

  const leitung: Leitung = {
    invoke: <T>(kanal: string, eingabe?: unknown) => post('/api/rpc', code, { kanal, eingabe }) as Promise<T>,
    send: (kanal, eingabe) => void post('/api/senden', code, { kanal, eingabe }).catch(() => undefined),
    on: (kanal, h) => {
      const menge = hoerer.get(kanal) ?? new Set()
      menge.add(h)
      hoerer.set(kanal, menge)
      return () => menge.delete(h)
    }
  }

  const datei = (pfad: string): string => `/api/datei?token=${encodeURIComponent(code)}&pfad=${encodeURIComponent(pfad)}`
  const nurAmRechner = (): Promise<never> => Promise.reject(new Error('Das geht nur am Rechner selbst.'))

  ;(window as unknown as { desk: unknown }).desk = bauDesk(leitung, 'web', true, {
    // Kein Fenster zu steuern — das ist der Browser.
    win: {
      close: async () => undefined,
      minimize: async () => undefined,
      toggleMaximize: async () => undefined,
      isMaximized: async () => false,
      onStateChanged: () => () => undefined
    },
    // Ein Dialog auf dem Rechner nützt dem Handy nichts: den Pfad eintippen.
    dialogs: {
      pickFolder: async (aktuell) => {
        const pfad = window.prompt('Ordner auf dem Rechner (voller Pfad):', aktuell ?? '')
        return pfad && pfad.trim() ? pfad.trim() : null
      }
    },
    shell: {
      reveal: async (pfad) => herunterladen(datei(pfad)),
      copy: (text) => kopieren(text)
    },
    documents: {
      open: async (pfad) => herunterladen(datei(pfad)),
      reveal: async (pfad) => herunterladen(datei(pfad)),
      saveAs: async (pfad) => {
        herunterladen(datei(pfad))
        return null
      },
      watch: () => undefined
    },
    artifacts: {
      export: async (artifact: Artifact) => {
        const endung = artifact.kind === 'html' ? 'html' : artifact.kind === 'svg' ? 'svg' : artifact.kind === 'markdown' ? 'md' : 'txt'
        const url = URL.createObjectURL(new Blob([artifact.body], { type: 'text/plain;charset=utf-8' }))
        herunterladen(url, `${(artifact.title || 'artifact').replace(/[\\/:*?"<>|]+/g, '-')}.${endung}`)
        setTimeout(() => URL.revokeObjectURL(url), 5000)
        return null
      }
    },
    skills: {
      importFolder: nurAmRechner,
      reveal: nurAmRechner
    }
  })
}
