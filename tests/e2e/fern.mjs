#!/usr/bin/env node
/**
 * Fernzugang von einem anderen Gerät aus prüfen — so, wie ein MacBook oder ein
 * Handy die Oberfläche öffnet: eigener Browser, Netzadresse mit Code.
 *
 *   node tests/e2e/fern.mjs "<Adresse mit ?token=…>"
 *
 * 1. MacBook (1440 × 900): Über den Fernzugang läuft **dieselbe** Oberfläche
 *    wie am Rechner — deshalb läuft hier auch dieselbe Prüfung (drive.mjs).
 * 2. Handy (390 × 844): dieselbe App, fürs Smartphone umgebrochen.
 *
 * Braucht eine laufende Hestia mit eingeschaltetem Fernzugang und einem
 * erreichbaren Modell. Exit-Code 1 bei Fehlern.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ADRESSE = process.argv[2]
const PORT = Number(process.argv[3] ?? 9333)
if (!ADRESSE || !ADRESSE.includes('token=')) {
  console.error('Aufruf: node tests/e2e/fern.mjs "<Adresse mit ?token=…>"')
  process.exit(2)
}
const warte = (ms) => new Promise((r) => setTimeout(r, ms))
const ergebnisse = []
function check(name, ok, detail) {
  ergebnisse.push(Boolean(ok))
  console.log(`${ok ? '  ok  ' : ' FEHLER'}  ${name}${detail !== undefined ? ` — ${String(detail).slice(0, 200)}` : ''}`)
}

const profil = mkdtempSync(join(tmpdir(), 'hestia-fern-'))
const browser = spawn(
  'google-chrome',
  ['--headless=new', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profil}`, '--window-size=1440,900', ADRESSE],
  { stdio: 'ignore' }
)

try {
  await warte(5000)

  // ------------------------------------------------------ 1. MacBook
  console.log('— MacBook: dieselbe Prüfung wie am Rechner —')
  const lauf = spawnSync('node', [join(dirname(fileURLToPath(import.meta.url)), 'drive.mjs'), String(PORT)], { encoding: 'utf8', timeout: 900_000 })
  const summe = /(\d+)\/(\d+) Prüfungen bestanden/.exec(lauf.stdout ?? '')
  for (const zeile of (lauf.stdout ?? '').split('\n').filter((z) => z.startsWith(' FEHLER'))) console.log(zeile)
  check('MacBook: alle Desktop-Prüfungen bestehen im Browser', lauf.status === 0, summe ? `${summe[1]}/${summe[2]}` : lauf.stderr?.slice(0, 200))

  // ------------------------------------------------------ 2. Handy
  console.log('— Handy —')
  const ziel = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')
  const ws = new WebSocket(ziel.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let naechste = 0
  const senden = (method, params = {}) =>
    new Promise((ok) => {
      const id = ++naechste
      const hoer = (e) => {
        const m = JSON.parse(e.data)
        if (m.id !== id) return
        ws.removeEventListener('message', hoer)
        ok(m.result)
      }
      ws.addEventListener('message', hoer)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const js = async (rumpf) => (await senden('Runtime.evaluate', { expression: `(async () => { ${rumpf} })()`, awaitPromise: true, returnByValue: true })).result?.value
  const im = `(e) => { const r = e?.getBoundingClientRect(); return Boolean(r) && r.left >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 }`

  await senden('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await senden('Page.navigate', { url: ADRESSE })
  await warte(3500)
  const start = await js(`return { breite: innerWidth, ueberlauf: document.documentElement.scrollWidth > innerWidth + 1, leiste: document.querySelector('.app-shell')?.dataset.sidebar, fenster: Boolean(document.querySelector('[title="Schließen"], [title="Close"]')) }`)
  check('Handy: kein seitliches Überlaufen, die Seite zoomt nicht heraus', start.breite === 390 && !start.ueberlauf, JSON.stringify(start))
  check('Handy: die Leiste startet als geschlossene Schublade', start.leiste === 'closed')
  check('Handy: keine Fensterknöpfe (die gibt es im Browser nicht)', !start.fenster)

  const schublade = await js(`
    document.querySelector('.titlebar .icon-btn').click(); await new Promise((r) => setTimeout(r, 400))
    const offen = document.querySelector('.app-shell').dataset.sidebar
    const breite = Math.round(document.querySelector('.sidebar').getBoundingClientRect().width)
    document.querySelector('.chat-row')?.click(); await new Promise((r) => setTimeout(r, 900))
    return { offen, breite, danach: document.querySelector('.app-shell').dataset.sidebar, eingabe: (${im})(document.querySelector('.composer')) }`)
  check('Handy: die Schublade geht auf und nach der Wahl von selbst zu', schublade.offen === 'open' && schublade.breite <= 390 && schublade.danach === 'closed', JSON.stringify(schublade))
  check('Handy: das Eingabefeld passt ganz auf den Bildschirm', schublade.eingabe)

  const menue = await js(`
    document.querySelector('.pill').click(); await new Promise((r) => setTimeout(r, 400))
    const m = (${im})(document.querySelector('.modellmenue'))
    ;[...document.querySelectorAll('.modellmenue__zeile')][0]?.click(); await new Promise((r) => setTimeout(r, 400))
    const s = (${im})(document.querySelector('.stufenliste'))
    const stufen = document.querySelectorAll('.stufenliste__punkt').length
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    return { menue: m, aufwand: s, stufen }`)
  check('Handy: Modellmenü und Aufwand stehen ganz im Bild', menue.menue && menue.aufwand && menue.stufen === 5, JSON.stringify(menue))

  const dialog = await js(`
    const knopf = [...document.querySelectorAll('.titlebar .icon-btn')].find((b) => /Suche|Search/i.test(b.title))
    knopf?.click(); await new Promise((r) => setTimeout(r, 400))
    const o = document.querySelector('.overlay')
    const r = o?.getBoundingClientRect()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    return { da: Boolean(o), voll: Boolean(r) && Math.round(r.width) === innerWidth }`)
  check('Handy: Dialoge nehmen den ganzen Bildschirm', dialog.da && dialog.voll, JSON.stringify(dialog))
  ws.close()
} catch (fehler) {
  check('Durchlauf ohne Ausnahme', false, fehler.message)
} finally {
  browser.kill()
  await warte(300)
  rmSync(profil, { recursive: true, force: true })
}

const fehl = ergebnisse.filter((ok) => !ok).length
console.log(`\n${ergebnisse.length - fehl}/${ergebnisse.length} Prüfungen bestanden`)
process.exit(fehl ? 1 : 0)
