/**
 * Fernzugang: dieselbe Oberfläche im Browser, dieselben Kanäle über HTTP.
 * Geprüft wird vor allem, was **nicht** gehen darf — ohne Code, aus dem Ordner
 * der Oberfläche heraus, an die Datenbank, an die Kanäle, die am Rechner einen
 * Dialog öffnen würden.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), isPackaged: false } }))

import { Channels } from '../../src/shared/ipc'
import { fernEinseitig, fernEmpfaenger, fernLeeren, fernRundruf } from '../../src/main/fern'
import { MobileAccess } from '../../src/main/mobile/server'

let wurzel: string
let oberflaeche: string
let dokumente: string
let daten: string

beforeAll(async () => {
  wurzel = await mkdtemp(join(tmpdir(), 'fern-'))
  oberflaeche = join(wurzel, 'renderer')
  dokumente = join(wurzel, 'dokumente')
  daten = join(wurzel, 'daten')
  await mkdir(join(oberflaeche, 'assets'), { recursive: true })
  await mkdir(dokumente, { recursive: true })
  await mkdir(daten, { recursive: true })
  await writeFile(join(oberflaeche, 'index.html'), '<!doctype html><title>Hestia</title><div id="root"></div>')
  await writeFile(join(oberflaeche, 'assets', 'app-123.js'), 'console.log(1)')
  await writeFile(join(wurzel, 'geheim.js'), 'geheim')
  await writeFile(join(dokumente, 'Bericht.pdf'), '%PDF-1.7 Prüfung')
  await writeFile(join(daten, 'hestia.db'), 'Datenbank')
  await mkdir(join(wurzel, 'pwa'), { recursive: true })
  await writeFile(join(wurzel, 'pwa', 'icon-192.png'), 'PNG')
  process.env['HESTIA_DOKUMENTE'] = dokumente
})

afterAll(async () => {
  delete process.env['HESTIA_DOKUMENTE']
  fernLeeren()
  await rm(wurzel, { recursive: true, force: true })
})

const tokenAus = (url?: string): string => new URL(url ?? 'http://x/').searchParams.get('token') ?? ''

describe('Fernzugang', () => {
  let zugang: MobileAccess
  let basis = ''
  let code = ''
  const aufrufe: unknown[] = []
  const gesendet: unknown[] = []

  beforeAll(async () => {
    fernEmpfaenger(Channels.chatList, async (eingabe) => {
      aufrufe.push(eingabe)
      return [{ id: 'c1', title: 'Vom Rechner' }]
    })
    fernEmpfaenger(Channels.folderPick, async () => '/irgendwo')
    fernEmpfaenger(Channels.mobileStop, async () => ({ running: false }))
    fernEinseitig(Channels.permissionRespond, (entscheidung) => gesendet.push(entscheidung))
    zugang = new MobileAccess({ oberflaeche, datenordner: daten, symbole: join(wurzel, 'pwa') })
    const status = await zugang.start(0)
    basis = `http://127.0.0.1:${status.port}`
    code = tokenAus(status.url)
  })

  afterAll(async () => {
    await zugang.stop()
  })

  const rpc = (kanal: string, eingabe?: unknown, mitCode = true) =>
    fetch(`${basis}/api/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(mitCode ? { 'x-hestia-code': code } : {}) },
      body: JSON.stringify({ kanal, eingabe })
    })

  it('zeigt die Oberfläche nur mit Code — ohne einen Satz, was zu tun ist', async () => {
    const mit = await fetch(`${basis}/?token=${code}`)
    expect(mit.status).toBe(200)
    expect(await mit.text()).toContain('<div id="root">')
    const ohne = await fetch(`${basis}/`)
    expect(ohne.status).toBe(401)
    expect(await ohne.text()).toContain('Dieser Link gilt nicht mehr')
    expect((await fetch(`${basis}/?token=${'0'.repeat(24)}`)).status).toBe(401)
  })

  it('macht die Seite zur App für den Home-Bildschirm — mit Code, nur mit Code', async () => {
    const seite = await (await fetch(`${basis}/?token=${code}`)).text()
    expect(seite).toContain(`/manifest.webmanifest?token=${code}`)
    expect(seite).toContain('apple-mobile-web-app-capable')
    const manifest = await fetch(`${basis}/manifest.webmanifest?token=${code}`)
    expect(manifest.status).toBe(200)
    const daten = (await manifest.json()) as { display: string; start_url: string; icons: unknown[] }
    expect(daten.display).toBe('standalone')
    expect(daten.start_url).toBe(`/?token=${code}`)
    expect(daten.icons.length).toBeGreaterThan(0)
    expect((await fetch(`${basis}/manifest.webmanifest`)).status).toBe(401)
    expect((await fetch(`${basis}/pwa/icon-192.png`)).status).toBe(200)
    expect((await fetch(`${basis}/pwa/..%2F..%2Fdaten%2Fhestia.db`)).status).toBe(404)
    expect((await fetch(`${basis}/sw.js`)).headers.get('content-type')).toContain('javascript')
  })

  it('liefert Bausteine der Oberfläche, aber nichts außerhalb ihres Ordners', async () => {
    const skript = await fetch(`${basis}/assets/app-123.js`)
    expect(skript.status).toBe(200)
    expect(skript.headers.get('content-type')).toContain('javascript')
    expect((await fetch(`${basis}/../geheim.js`)).status).toBe(404)
    expect((await fetch(`${basis}/assets/%2e%2e/%2e%2e/geheim.js`)).status).toBe(404)
    expect((await fetch(`${basis}/assets/fehlt.js`)).status).toBe(404)
  })

  it('vermittelt Kanäle nur mit Code', async () => {
    expect((await rpc(Channels.chatList, { x: 1 }, false)).status).toBe(401)
    const antwort = await rpc(Channels.chatList, { x: 1 })
    expect(antwort.status).toBe(200)
    expect(await antwort.json()).toEqual({ wert: [{ id: 'c1', title: 'Vom Rechner' }] })
    expect(aufrufe).toEqual([{ x: 1 }])
  })

  it('sperrt, was am Rechner einen Dialog öffnen oder das Gerät aussperren würde', async () => {
    for (const kanal of [Channels.folderPick, Channels.mobileStop]) {
      const antwort = await rpc(kanal)
      expect(antwort.status).toBe(400)
      expect(((await antwort.json()) as { error: string }).error).toMatch(/nur am Rechner/)
    }
    expect((await rpc('gibt:es-nicht')).status).toBe(400)
  })

  it('nimmt Freigaben aus dem Browser entgegen', async () => {
    const antwort = await fetch(`${basis}/api/senden`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hestia-code': code },
      body: JSON.stringify({ kanal: Channels.permissionRespond, eingabe: { id: 'f1', allowed: true } })
    })
    expect(antwort.status).toBe(200)
    expect(gesendet).toEqual([{ id: 'f1', allowed: true }])
  })

  it('reicht Ereignisse des Hauptprogramms live an den Browser weiter', async () => {
    const steuer = new AbortController()
    const bahn = await fetch(`${basis}/api/ereignisse?token=${code}`, { signal: steuer.signal })
    const leser = bahn.body!.getReader()
    await leser.read() // „verbunden“
    fernRundruf(Channels.streamEvent, [{ type: 'delta_text', text: 'Hallo' }])
    const { value } = await leser.read()
    steuer.abort()
    const zeile = new TextDecoder().decode(value)
    expect(JSON.parse(zeile.replace(/^data: /, '').trim())).toEqual({ kanal: Channels.streamEvent, werte: [{ type: 'delta_text', text: 'Hallo' }] })
  })

  it('gibt Dokumente zum Herunterladen — die Datenbank nie', async () => {
    const pdf = await fetch(`${basis}/api/datei?token=${code}&pfad=${encodeURIComponent(join(dokumente, 'Bericht.pdf'))}`)
    expect(pdf.status).toBe(200)
    expect(pdf.headers.get('content-disposition')).toContain('attachment')
    expect(await pdf.text()).toContain('Prüfung')
    const db = await fetch(`${basis}/api/datei?token=${code}&pfad=${encodeURIComponent(join(daten, 'hestia.db'))}`)
    expect(db.status).toBe(404)
    const fremd = await fetch(`${basis}/api/datei?token=${code}&pfad=${encodeURIComponent('/etc/passwd')}`)
    expect(fremd.status).toBe(404)
    const ohneCode = await fetch(`${basis}/api/datei?pfad=${encodeURIComponent(join(dokumente, 'Bericht.pdf'))}`)
    expect(ohneCode.status).toBe(401)
  })
})

describe('Fernzugang bei belegtem Port', () => {
  it('nimmt den nächsten freien Port', async () => {
    const besetzer = createServer()
    await new Promise<void>((fertig) => besetzer.listen(0, '0.0.0.0', fertig))
    const belegt = (besetzer.address() as { port: number }).port
    const zugang = new MobileAccess({ oberflaeche })
    try {
      const status = await zugang.start(belegt)
      expect(status.running).toBe(true)
      expect(status.port).toBeGreaterThan(belegt)
      expect(status.port).toBeLessThan(belegt + 10)
    } finally {
      await zugang.stop()
      await new Promise<void>((fertig) => besetzer.close(() => fertig()))
    }
  })
})

describe('Fernzugang mit Gedächtnis (MacBook-Lesezeichen)', () => {
  it('behält den Code über Aus und An hinweg', async () => {
    let gemerkt: string | undefined
    const gedaechtnis = { lesen: () => gemerkt, merken: (c: string) => (gemerkt = c) }
    const zugang = new MobileAccess({ oberflaeche }, gedaechtnis)
    const erst = tokenAus((await zugang.start(0)).url)
    await zugang.stop()
    const wieder = new MobileAccess({ oberflaeche }, gedaechtnis)
    const dann = tokenAus((await wieder.start(0)).url)
    await wieder.stop()
    expect(erst).toMatch(/^[0-9a-f]{24}$/)
    expect(dann).toBe(erst)
  })

  it('ein neuer Code sperrt den alten Link aus', async () => {
    let gemerkt: string | undefined
    const zugang = new MobileAccess({ oberflaeche }, { lesen: () => gemerkt, merken: (c) => (gemerkt = c) })
    const status = await zugang.start(0)
    const alt = tokenAus(status.url)
    const neu = tokenAus((await zugang.neuerCode()).url)
    const basis = `http://127.0.0.1:${status.port}`
    try {
      expect(neu).not.toBe(alt)
      expect(gemerkt).toBe(neu)
      expect((await fetch(`${basis}/?token=${alt}`)).status).toBe(401)
      expect((await fetch(`${basis}/?token=${neu}`)).status).toBe(200)
    } finally {
      await zugang.stop()
    }
  })

  it('ohne Gedächtnis gibt es bei jedem An einen neuen Code', async () => {
    const zugang = new MobileAccess({ oberflaeche })
    const erst = tokenAus((await zugang.start(0)).url)
    await zugang.stop()
    const dann = tokenAus((await zugang.start(0)).url)
    await zugang.stop()
    expect(dann).not.toBe(erst)
  })
})
