/**
 * Fernzugang: dieselbe Oberfläche wie am Rechner, im Browser eines anderen
 * Geräts im Netz — MacBook, Handy.
 *
 * Früher lieferte der Dienst eine eigene, schlanke Handyseite; die sah anders
 * aus und konnte weniger. Jetzt liefert er **die** Oberfläche aus und vermittelt
 * ihre Kanäle (siehe fern.ts). Drei Dinge sind dabei wichtiger als Komfort:
 *
 * 1. Aus. Der Dienst läuft nur, wenn er eingeschaltet wurde.
 * 2. Schlüssel. Ohne den Code aus dem QR-Code antwortet keine Datenroute; die
 *    Oberfläche selbst erscheint ohne Code gar nicht erst.
 * 3. Kurze Leine. Größen sind begrenzt; Dateien gibt es nur aus der
 *    Dokumentablage und den Arbeitsordnern — nie aus dem Datenordner der App.
 */
import { execFile } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import { basename, extname, join, normalize, resolve, sep } from 'node:path'
import QRCode from 'qrcode'
import type { MobileStatus } from '@shared/types'
import { log } from '../logger'
import { fernAufruf, fernHoeren, fernSenden } from '../fern'
import { assertAllowed } from '../documents/registry'

/** Der Standardhafen; ist er belegt, springt der Dienst auf den nächsten freien. */
export const MOBILE_PORT = 8782

/** Wie viele Geräte gleichzeitig mithören dürfen. */
const MAX_CLIENTS = 8

/** Größte Anfrage: Bilder und Diktate reisen als Base64 mit. */
const MAX_BODY = 40_000_000

const TYPEN: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
}

/** Was der Zugang vom Rest der App braucht. */
export interface MobileOptionen {
  /** Ordner der gebauten Oberfläche (index.html, assets/). */
  oberflaeche: string
  /** Datenordner der App — aus ihm wird nie eine Datei ausgeliefert. */
  datenordner?: string
  /** Symbole für den Home-Bildschirm (build/pwa). */
  symbole?: string
}

/** Ein Service Worker, der nichts zwischenspeichert — er macht die Seite nur
 *  installierbar. Gespräche gehören nicht in einen Zwischenspeicher. */
const DIENSTHELFER = "self.addEventListener('install', () => self.skipWaiting())\nself.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))\nself.addEventListener('fetch', () => undefined)\n"

/**
 * Was die Seite zur App auf dem Home-Bildschirm macht: Vollbild ohne
 * Browserleisten, das Symbol, der Name. Der Code steckt in der Adresse des
 * Manifests, damit das Handy beim Öffnen vom Home-Bildschirm drin ist.
 */
function homeBildschirm(code: string): string {
  const c = encodeURIComponent(code)
  return [
    `<link rel="manifest" href="/manifest.webmanifest?token=${c}">`,
    '<link rel="apple-touch-icon" href="/pwa/apple-touch-icon.png">',
    '<link rel="icon" type="image/png" sizes="192x192" href="/pwa/icon-192.png">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-title" content="Hestia">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black">',
    '<meta name="theme-color" content="#1b1a18">'
  ].join('')
}

export class MobileAccess {
  private server: Server | null = null
  private token = ''
  private port = 0
  private lastError: string | undefined
  /** Langlebige Verbindungen der Geräte (Server-Sent Events). */
  private listeners = new Set<ServerResponse>()
  private unsubscribe: (() => void) | null = null
  private herzschlag: NodeJS.Timeout | null = null

  /**
   * `gedaechtnis` hält den Zugangscode über Neustarts hinweg. Ohne ihn gibt es
   * bei jedem Einschalten einen neuen — für ein Handy, das den QR-Code jedes
   * Mal neu scannt, ist das recht; für ein MacBook mit Lesezeichen nicht.
   */
  constructor(
    private readonly optionen: MobileOptionen,
    private readonly gedaechtnis?: { lesen(): string | undefined; merken(code: string): void }
  ) {}

  /**
   * Einen neuen Zugangscode ausgeben. Alle bisherigen Links und QR-Codes
   * werden sofort wertlos, verbundene Geräte fliegen raus.
   */
  async neuerCode(): Promise<MobileStatus> {
    this.token = randomBytes(12).toString('hex')
    this.gedaechtnis?.merken(this.token)
    for (const client of this.listeners) client.end()
    this.listeners.clear()
    log.info('Mobile-Zugang: neuer Code — alte Links gelten nicht mehr')
    return this.status()
  }

  get active(): boolean {
    return this.server !== null
  }

  /** Adressen im lokalen Netz, in der Reihenfolge ihrer Brauchbarkeit. */
  private lanAddresses(): string[] {
    const interfaces = networkInterfaces()
    const found: string[] = []
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries ?? []) {
        // IPv4, kein Ringschluss — das ist das Netz, in dem das Handy sitzt.
        if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address)
      }
    }
    return found
  }

  /**
   * Startet den Dienst. `port` ist ein Wunsch: Ist er belegt, nimmt der
   * Rechner den nächsten freien, damit der Start nicht an einer Kleinigkeit
   * scheitert.
   */
  async start(port: number = MOBILE_PORT): Promise<MobileStatus> {
    if (this.server) return this.status()
    this.lastError = undefined
    // Mit Gedächtnis bleibt der Code, damit Lesezeichen gültig bleiben; ohne
    // gibt es bei jedem An einen neuen, und ein alter QR-Code taugt nicht mehr.
    const gemerkt = this.gedaechtnis?.lesen()
    this.token = gemerkt && /^[0-9a-f]{24}$/.test(gemerkt) ? gemerkt : randomBytes(12).toString('hex')
    this.gedaechtnis?.merken(this.token)

    const server = createServer((request, response) => {
      void this.route(request, response)
    })

    const lauschen = (versuch: number): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => reject(error)
        server.once('error', onError)
        server.listen(versuch, '0.0.0.0', () => {
          server.removeListener('error', onError)
          resolve()
        })
      })

    // Ist der Port belegt (eine zweite Hestia, ein anderes Programm), wird der
    // nächste freie genommen — die Adresse steckt ohnehin im QR-Code. Vorher
    // blieb der Zugang aus, mit „listen EADDRINUSE" als einziger Auskunft.
    const versuche = port === 0 ? [0] : Array.from({ length: 10 }, (_, i) => port + i)
    for (const [nummer, versuch] of versuche.entries()) {
      try {
        await lauschen(versuch)
        break
      } catch (fehler) {
        const belegt = (fehler as NodeJS.ErrnoException).code === 'EADDRINUSE'
        if (!belegt || nummer === versuche.length - 1) {
          this.lastError = belegt
            ? `Die Ports ${versuche[0]} bis ${versuche.at(-1)} sind alle belegt.`
            : (fehler as Error).message
          throw new Error(this.lastError, { cause: fehler })
        }
        log.info('Mobile-Zugang: Port belegt, nächster', { port: versuch })
      }
    }

    const info = server.address() as AddressInfo
    this.port = info.port
    this.server = server
    // Wirft der Rechner später einen Fehler (abgerissene Handys sind normal),
    // soll er nicht die Anwendung zu Fall bringen.
    server.on('error', (error) => {
      this.lastError = error.message
      log.warn('Mobile-Zugang: Verbindungsfehler', error.message)
    })

    // Läufe landen auf dem Schreibtisch und auf dem Handy zugleich.
    // Alles, was das Hauptprogramm der Oberfläche schickt, geht an die Geräte.
    this.unsubscribe = fernHoeren((kanal, werte) => this.rundruf(kanal, werte))
    // Ein Kommentar alle 25 s hält die Leitung offen — Funknetze und
    // Energiesparen schließen stille Verbindungen gern.
    this.herzschlag = setInterval(() => {
      for (const client of this.listeners) client.write(': da\n\n')
    }, 25_000)

    const status = await this.status()
    // Ohne Code: der gilt dauerhaft und gehört nicht in eine Logdatei.
    log.info('Mobile-Zugang gestartet', { adresse: (status.url ?? '').split('?')[0], port: this.port })
    return status
  }

  async stop(): Promise<MobileStatus> {
    for (const client of this.listeners) {
      client.end()
    }
    this.listeners.clear()
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.herzschlag) clearInterval(this.herzschlag)
    this.herzschlag = null
    this.server?.close()
    this.server = null
    this.token = ''
    log.info('Mobile-Zugang beendet')
    return { running: false }
  }

  async status(): Promise<MobileStatus> {
    if (!this.server) {
      return { running: false, lastError: this.lastError, addresses: this.lanAddresses() }
    }
    const url = this.connectionUrl()
    const sicher = await this.sichereAdresse()
    return {
      running: true,
      url,
      qr: await this.qrFor(url),
      ...(sicher ? { sicher, sicherQr: await this.qrFor(sicher) } : {}),
      port: this.port,
      clients: this.listeners.size,
      addresses: this.lanAddresses(),
      lastError: this.lastError
    }
  }

  /**
   * Stellt Tailscale diesen Zugang per https bereit (`tailscale serve`)? Dann
   * gibt es eine zweite Adresse: im ganzen Tailnet erreichbar, mit gültigem
   * Zertifikat — dort erlauben Handys das Vollbild ohne Browserleisten und das
   * Mikrofon. Nachgesehen wird höchstens alle 30 Sekunden.
   */
  private sicherGemerkt: { zeit: number; wert?: string } = { zeit: 0 }
  private async sichereAdresse(): Promise<string | undefined> {
    if (Date.now() - this.sicherGemerkt.zeit < 30_000) return this.sicherGemerkt.wert?.replace('{code}', this.token)
    let wert: string | undefined
    try {
      const { stdout } = await new Promise<{ stdout: string }>((ok, fehl) =>
        execFile('tailscale', ['serve', 'status', '--json'], { timeout: 2500 }, (fehler, stdout) => (fehler ? fehl(fehler) : ok({ stdout })))
      )
      const daten = JSON.parse(stdout || '{}') as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> }
      for (const [hostPort, eintrag] of Object.entries(daten.Web ?? {})) {
        const ziel = eintrag.Handlers?.['/']?.Proxy ?? ''
        if (new RegExp(`^http://(127\\.0\\.0\\.1|localhost):${this.port}/?$`).test(ziel)) {
          wert = `https://${hostPort.replace(/:443$/, '')}/?token={code}`
          break
        }
      }
    } catch {
      /* kein Tailscale, oder kein serve — dann eben nur das lokale Netz */
    }
    this.sicherGemerkt = { zeit: Date.now(), wert }
    return wert?.replace('{code}', this.token)
  }

  private connectionUrl(): string {
    const host = this.lanAddresses()[0] ?? '127.0.0.1'
    return `http://${host}:${this.port}/?token=${this.token}`
  }

  /** QR-Code als SVG in einer Datenadresse — kein zusätzliches Bauteil nötig. */
  private async qrFor(url: string): Promise<string> {
    const svg = await QRCode.toString(url, {
      type: 'svg',
      margin: 2,
      width: 320,
      color: { dark: '#241f1a', light: '#fffdf9' },
      errorCorrectionLevel: 'M'
    })
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
  }

  /** Konstanter Vergleich: Die Länge stimmt nur bei richtiger Tokenlänge. */
  private tokenOk(candidate: string | null): boolean {
    if (!this.token || !candidate) return false
    const a = Buffer.from(candidate)
    const b = Buffer.from(this.token)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  }

  private rundruf(kanal: string, werte: unknown[]): void {
    if (!this.listeners.size) return
    const payload = `data: ${JSON.stringify({ kanal, werte })}\n\n`
    for (const client of this.listeners) client.write(payload)
  }

  // ------------------------------------------------------------------ Routen
  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const started = Date.now()
    const url = new URL(request.url ?? '/', 'http://localhost')
    const path = url.pathname
    // Kein Caching: der Zugangsstand wechselt, und Chats sind nicht zum
    // Mitschreiben in einem Zwischenspeicher gedacht.
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')

    try {
      const code = url.searchParams.get('token') ?? (request.headers['x-hestia-code'] as string | undefined) ?? null

      // Die Oberfläche selbst: nur mit gültigem Code, sonst ein Satz, was zu tun ist.
      if (path === '/' || path === '/index.html') {
        if (request.method !== 'GET' && request.method !== 'HEAD') return this.json(response, 405, { error: 'Methode nicht erlaubt' })
        if (!this.tokenOk(code)) return this.deny(request, response, true)
        const html = (await readFile(join(this.optionen.oberflaeche, 'index.html'), 'utf8'))
          // Ränder des Bildschirms (Notch, Home-Balken) mitnutzen können.
          .replace('content="width=device-width, initial-scale=1.0"', 'content="width=device-width, initial-scale=1.0, viewport-fit=cover"')
        const zusatz = homeBildschirm(code ?? '')
        response.writeHead(200, { 'content-type': TYPEN['.html']! })
        response.end(html.includes('</head>') ? html.replace('</head>', `${zusatz}</head>`) : zusatz + html)
        return
      }

      // Die App-Beschreibung für den Home-Bildschirm: mit Code, damit ein
      // Öffnen vom Symbol aus gleich angemeldet ist.
      if (path === '/manifest.webmanifest') {
        if (!this.tokenOk(code)) return this.deny(request, response)
        response.writeHead(200, { 'content-type': TYPEN['.webmanifest']! })
        response.end(
          JSON.stringify({
            name: 'Hestia',
            short_name: 'Hestia',
            description: 'Lokale Modelle. Chat und Agent im eigenen Ordner.',
            start_url: `/?token=${encodeURIComponent(code ?? '')}`,
            scope: '/',
            display: 'standalone',
            background_color: '#1b1a18',
            theme_color: '#1b1a18',
            lang: 'de',
            icons: [
              { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
              { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
            ]
          })
        )
        return
      }
      if (path === '/sw.js') {
        response.writeHead(200, { 'content-type': TYPEN['.js']!, 'service-worker-allowed': '/' })
        response.end(DIENSTHELFER)
        return
      }
      if (path.startsWith('/pwa/') && this.optionen.symbole) {
        const name = basename(path)
        if (!/^[a-z0-9-]+\.png$/.test(name)) return this.json(response, 404, { error: 'Nicht gefunden' })
        const datei = join(this.optionen.symbole, name)
        const info = await stat(datei).catch(() => undefined)
        if (!info?.isFile()) return this.json(response, 404, { error: 'Nicht gefunden' })
        response.writeHead(200, { 'content-type': 'image/png', 'content-length': String(info.size), 'cache-control': 'public, max-age=86400' })
        createReadStream(datei).pipe(response)
        return
      }

      // Bausteine der Oberfläche (Skripte, Stile, Schriften): Code, der ohnehin
      // in jeder Kopie der App steckt — ohne Daten, deshalb ohne Schlüssel.
      if (!path.startsWith('/api/')) {
        if (request.method !== 'GET' && request.method !== 'HEAD') return this.json(response, 405, { error: 'Methode nicht erlaubt' })
        return this.baustein(path, response)
      }

      if (!this.tokenOk(code)) return this.deny(request, response)

      if (path === '/api/ereignisse') {
        if (request.method !== 'GET') return this.json(response, 405, { error: 'Methode nicht erlaubt' })
        if (this.listeners.size >= MAX_CLIENTS) return this.json(response, 503, { error: 'Zu viele Geräte angemeldet' })
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no'
        })
        response.write(': verbunden\n\n')
        this.listeners.add(response)
        request.on('close', () => this.listeners.delete(response))
        return
      }

      if (path === '/api/datei') {
        if (request.method !== 'GET') return this.json(response, 405, { error: 'Methode nicht erlaubt' })
        return this.datei(url.searchParams.get('pfad') ?? '', response)
      }

      if (path === '/api/rpc' || path === '/api/senden') {
        if (request.method !== 'POST') return this.json(response, 405, { error: 'Methode nicht erlaubt' })
        const body = await this.readJson(request, response)
        if (!body) return
        const kanal = typeof body.kanal === 'string' ? body.kanal : ''
        if (!kanal) return this.json(response, 400, { error: 'Kanal fehlt' })
        try {
          if (path === '/api/senden') {
            fernSenden(kanal, body.eingabe)
            return this.json(response, 200, { ok: true })
          }
          const wert = await fernAufruf(kanal, body.eingabe)
          return this.json(response, 200, { wert: wert === undefined ? null : wert })
        } catch (fehler) {
          // Die Meldung, wie sie am Rechner auch erschiene — ohne Stapel.
          const text = fehler instanceof Error ? fehler.message : String(fehler)
          log.warn('Fernaufruf abgelehnt', { kanal, grund: text.slice(0, 200) })
          return this.json(response, 400, { error: text })
        }
      }

      this.json(response, 404, { error: 'Unbekannter Pfad' })
    } catch (error) {
      // Ein kaputter Handy-Aufruf darf den Schreibtisch nicht stören.
      log.warn('Mobile-Zugang: Anfrage fehlgeschlagen', `${path}: ${(error as Error).message}`)
      if (!response.headersSent) this.json(response, 500, { error: 'Innerer Fehler' })
      else response.end()
    } finally {
      // Langlebige Ereignisbahnen dauern naturgemäß lang und gehören nicht
      // ins Protokoll; alles, was sonst über zwei Sekunden braucht, ist eine
      // Nachfrage wert (häufig: das Modell antwortet langsam).
      const elapsed = Date.now() - started
      if (elapsed > 2000 && !path.endsWith('/events')) {
        log.warn('Mobile-Zugang: späte Antwort', { path, ms: elapsed })
      }
    }
  }

  /** Liest einen JSON-Körper mit Größenbegrenzung. */
  /** Eine Datei der gebauten Oberfläche — nie etwas außerhalb davon. */
  private async baustein(pfad: string, response: ServerResponse): Promise<void> {
    const wurzel = resolve(this.optionen.oberflaeche)
    const ziel = resolve(wurzel, '.' + normalize(decodeURIComponent(pfad)))
    const typ = TYPEN[extname(ziel).toLowerCase()]
    if (!typ || (ziel !== wurzel && !ziel.startsWith(wurzel + sep))) return this.json(response, 404, { error: 'Nicht gefunden' })
    const info = await stat(ziel).catch(() => undefined)
    if (!info?.isFile()) return this.json(response, 404, { error: 'Nicht gefunden' })
    // Die Namen tragen einen Prüfwert (index-abc123.js) — sie dürfen lange liegen.
    response.setHeader('Cache-Control', /\/assets\//.test(pfad) ? 'public, max-age=31536000, immutable' : 'no-store')
    response.writeHead(200, { 'content-type': typ, 'content-length': String(info.size) })
    createReadStream(ziel).pipe(response)
  }

  /**
   * Eine Datei zum Herunterladen — statt „Öffnen“, „Speichern unter“ und „Im
   * Ordner zeigen“, die im Browser auf dem Rechner aufgingen. Nur aus der
   * Dokumentablage und den Arbeitsordnern; der Datenordner der App (mit der
   * Datenbank) bleibt ausdrücklich draußen.
   */
  private async datei(pfad: string, response: ServerResponse): Promise<void> {
    try {
      const erlaubt = await assertAllowed(pfad)
      const echt = await realpath(erlaubt)
      if (this.optionen.datenordner) {
        const daten = await realpath(this.optionen.datenordner).catch(() => resolve(this.optionen.datenordner!))
        if (echt === daten || echt.startsWith(daten + sep)) throw new Error('Nicht freigegeben')
      }
      const info = await stat(echt)
      if (!info.isFile()) throw new Error('Keine Datei')
      const name = basename(echt)
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(info.size),
        'content-disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`
      })
      createReadStream(echt).pipe(response)
    } catch {
      this.json(response, 404, { error: 'Datei nicht verfügbar' })
    }
  }

  private readJson(request: IncomingMessage, response: ServerResponse): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      let size = 0
      let tooLarge = false
      request.on('data', (chunk: Buffer) => {
        if (tooLarge) return
        size += chunk.length
        if (size > MAX_BODY) {
          tooLarge = true
          // Erst die Antwort hinausgeschrieben, dann die Verbindung zu: wer
          // zum Müllschlucken zerstört, bevor die Auskunft draußen ist,
          // liefert dem Handy einen abgebroffenen Aufruf statt einer Zahl.
          this.json(response, 413, { error: 'Anfrage zu groß' })
          response.end(() => request.destroy())
          resolve(null)
          return
        }
        chunks.push(chunk)
      })
      request.on('end', () => {
        if (tooLarge) return
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
        } catch {
          this.json(response, 400, { error: 'Ungültiges JSON' })
          resolve(null)
        }
      })
      request.on('error', () => resolve(null))
    })
  }

  private json(response: ServerResponse, code: number, payload: unknown): void {
    if (response.headersSent) {
      response.end()
      return
    }
    const body = JSON.stringify(payload)
    response.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    response.end(body)
  }

  private deny(request: IncomingMessage, response: ServerResponse, seite = false): void {
    log.warn('Mobile-Zugang: Zugriff ohne gültigen Schlüssel abgewiesen', request.socket.remoteAddress ?? '')
    if (!seite) {
      this.json(response, 401, { error: 'Zugriff nicht erlaubt' })
      return
    }
    // Wer die Seite mit altem Link öffnet, bekommt einen Satz statt JSON.
    response.writeHead(401, { 'content-type': 'text/html; charset=utf-8' })
    response.end(
      '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>Hestia</title><body style="font:17px/1.5 system-ui,sans-serif;background:#faf8f5;color:#241f1a;display:grid;place-items:center;min-height:90vh;margin:0;padding:24px;text-align:center">' +
        '<div><h1 style="font:500 26px Georgia,serif;margin:0 0 12px">Dieser Link gilt nicht mehr</h1>' +
        '<p style="margin:0;color:#6b645b">Auf dem Rechner in Hestia unter „Remote“ den QR-Code neu scannen oder die Adresse neu kopieren.</p></div></body></html>'
    )
  }
}
