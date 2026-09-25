/**
 * Die Suche für die Tiefere Recherche — ohne Schlüssel und ohne Konto.
 *
 * Gesucht wird über die schlichte Antwortseite von DuckDuckGo. Bewusst kein
 * Suchmaschinen-Abkommen: das braucht einen Schlüssel, und Schlüssel sollen hier
 * nicht vorkommen. Dafür gilt: zurückhaltend fragen, höflich auftauchen, und
 * wenn die Seite bremst, sagt das jemand — nicht „keine Ergebnisse".
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export class RechercheFehler extends Error {
  constructor(
    message: string,
    readonly grund?: string
  ) {
    super(message)
    this.name = 'RechercheFehler'
  }
}

export interface Fund {
  titel: string
  url: string
  text: string
}

const NENNER = 'Mozilla/5.0 (X11; Linux x86_64) Hestia-Recherche/1.0'
/** Pausen zwischen den Anfragen — eine Seite pro Sekunde ist noch höflich. */
let letzteAnfrage = 0
const PAUSE_MS = 1200

/** Liegt diese IP auf diesem Rechner, im Heimnetz oder in einem privaten Netz? */
export function privateIp(ip: string): boolean {
  let adresse = ip.toLowerCase().replace(/^\[|\]$/g, '')
  // IPv4 in IPv6 verpackt: ::ffff:127.0.0.1 oder ::ffff:7f00:1
  const verpackt = /^(?:0*:)*:?ffff:(.+)$/.exec(adresse)?.[1] ?? /^::(\d+\.\d+\.\d+\.\d+)$/.exec(adresse)?.[1]
  if (verpackt) {
    if (isIP(verpackt) === 4) adresse = verpackt
    else {
      const [hoch, tief] = verpackt.split(':').map((teil) => parseInt(teil, 16))
      if (Number.isFinite(hoch) && Number.isFinite(tief)) adresse = [hoch! >> 8, hoch! & 255, tief! >> 8, tief! & 255].join('.')
    }
  }
  if (isIP(adresse) === 4) {
    const [a, b] = adresse.split('.').map(Number) as [number, number]
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  if (isIP(adresse) === 6) {
    return adresse === '::' || adresse === '::1' || /^f[cd]/.test(adresse) || /^fe[89ab]/.test(adresse) || /^ff/.test(adresse)
  }
  return true
}

/**
 * Darf das Modell diese Adresse abrufen? Nur öffentliche Ziele: Der Name wird
 * aufgelöst und jede Adresse dahinter geprüft — nicht nur der Text im Link.
 * Eine gelesene Seite soll das Modell nicht dazu bringen, Ollama, den Router
 * oder andere Dienste im Heimnetz abzufragen.
 */
export async function oeffentlichesZiel(url: string): Promise<URL> {
  let ziel: URL
  try {
    ziel = new URL(url)
  } catch {
    throw new RechercheFehler('Keine gültige Adresse.')
  }
  if (ziel.protocol !== 'https:' && ziel.protocol !== 'http:') throw new RechercheFehler('Nur http- und https-Adressen.')
  const host = ziel.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|intranet)$/.test(host)) {
    throw new RechercheFehler('Adressen auf diesem Rechner oder im Heimnetz werden nicht gelesen.')
  }
  const adressen = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((eintrag) => eintrag.address)
  if (adressen.length === 0) throw new RechercheFehler('Diese Adresse gibt es nicht.')
  if (adressen.some(privateIp)) throw new RechercheFehler('Adressen auf diesem Rechner oder im Heimnetz werden nicht gelesen.')
  return ziel
}

async function pausierteAnfrage(url: string, signal: AbortSignal): Promise<Response> {
  const warten = letzteAnfrage + PAUSE_MS - Date.now()
  if (warten > 0) await new Promise((resolve) => setTimeout(resolve, warten))
  letzteAnfrage = Date.now()
  // Weiterleitungen selbst verfolgen: Jedes Ziel wird vorher geprüft, damit
  // eine öffentliche Seite nicht auf eine Adresse im Heimnetz umlenken kann.
  let ziel = url
  for (let sprung = 0; sprung < 6; sprung++) {
    await oeffentlichesZiel(ziel)
    const antwort = await fetch(ziel, { headers: { 'user-agent': NENNER, accept: 'text/html' }, signal, redirect: 'manual' })
    const weiter = antwort.headers.get('location')
    if (antwort.status >= 300 && antwort.status < 400 && weiter) {
      ziel = new URL(weiter, ziel).toString()
      continue
    }
    return antwort
  }
  throw new RechercheFehler('Zu viele Weiterleitungen.')
}

/** Zeichen, wie sie die Antwortseite schickt, zurück in lesbaren Text. */
export function entschlüsseln(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim()
}

/**
 * DuckDuckGo hängt Treffereilen an einen Umlenker. Dahinter liegt die echte
 * Adresse — ohne sie steht im Bericht nur eine fremde Zwischenstation.
 */
export function echteAdresse(url: string): string {
  try {
    const adressen = new URL(url, 'https://duckduckgo.com/')
    const sprung = adressen.searchParams.get('uddg')
    if (sprung) return decodeURIComponent(sprung)
    // Was von der Suchseite selbst kommt und keinen Umlenker mitbringt, ist
    // keine Fundstelle: Werbung und Zählwerk laufen über das eigene Host.
    if (adressen.hostname === 'duckduckgo.com' || adressen.hostname.endsWith('.duckduckgo.com')) return ''
  } catch {
    return ''
  }
  return url
}

/** Die Antwortseite in Treffer zerlegen. */
export function trefferLesen(html: string, höchste = 6): Fund[] {
  const funde: Fund[] = []
  // Erst die Fundstelle, dann in der Nähe nach dem Begleittext suchen: die
  // Seite bettet ihn je nach Ansicht in ein anderes Zeichenblatt.
  const anker = /class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  let treffer: RegExpExecArray | null
  while ((treffer = anker.exec(html)) && funde.length < höchste) {
    const url = echteAdresse(entschlüsseln(treffer[1] ?? ''))
    if (!url || !/^https?:/i.test(url)) continue
    const Umgebung = html.slice(treffer.index + treffer[0].length, treffer.index + treffer[0].length + 2500)
    const Beiwort = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]{0,1200}?)<\/(?:a|td|div)>/.exec(Umgebung)?.[1] ?? ''
    const titel = entschlüsseln((treffer[2] ?? '').replace(/<[^>]+>/g, ''))
    const text = entschlüsseln(Beiwort.replace(/<[^>]+>/g, ''))
    if (!titel) continue
    funde.push({ titel, url, text: text.slice(0, 480) })
  }
  return funde
}

/** Eine Seite anfragen. */
export async function suchen(begriff: string, opts: { höchste?: number; signal?: AbortSignal } = {}): Promise<Fund[]> {
  const signal = opts.signal ?? AbortSignal.timeout(15_000)
  const adresse = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(begriff)}`
  let antwort: Response
  try {
    antwort = await pausierteAnfrage(adresse, signal)
  } catch (fehler) {
    throw new RechercheFehler('Die Suchseite ist nicht zu erreichen.', String((fehler as Error).message))
  }
  if (antwort.status === 403 || antwort.status === 429 || antwort.status === 202) {
    throw new RechercheFehler('Die Suchseite bremst gerade. Kurze Pause, dann erneut versuchen.', String(antwort.status))
  }
  if (!antwort.ok) throw new RechercheFehler('Die Suchseite antwortet nicht brauchbar.', String(antwort.status))
  const html = await antwort.text()
  if (/anomaly|captcha/i.test(html)) {
    throw new RechercheFehler('Die Suchseite verlangt eine Prüfung. Ohne Prüfung ist hier Ende.')
  }
  return trefferLesen(html, opts.höchste ?? 6)
}

/**
 * Eine Seite lesen und auf lesbaren Text bringen.
 *
 * Kein Lesezeichen-Fürst: Skript, Stil und Auszeichnung ab, Zeilensprünge
 * halten, längster Block gewinnt nicht — es zählt die Reihenfolge.
 */
export function textAusHtml(html: string): string {
  const körper = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html
  const ohne = körper
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  // Zeilen, die nur aus Leerraum bestehen (Menüs, leere Container), fallen weg —
  // sonst füllt eine Seite das Kontextfenster mit Hunderten Leerzeilen.
  return entschlüsseln(ohne.replace(/[ \t]+/g, ' '))
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function leseSeite(url: string, opts: { zeichen?: number; signal?: AbortSignal } = {}): Promise<string> {
  const signal = opts.signal ?? AbortSignal.timeout(20_000)
  let antwort: Response
  try {
    antwort = await pausierteAnfrage(url, signal)
  } catch (fehler) {
    if (fehler instanceof RechercheFehler) throw fehler
    throw new RechercheFehler('Diese Seite ist nicht zu lesen.', String((fehler as Error).message))
  }
  if (!antwort.ok) throw new RechercheFehler('Diese Seite antwortet nicht.', String(antwort.status))
  const typ = antwort.headers.get('content-type') ?? ''
  // PDFs (Merkblätter, Richtlinien, Studien) sind oft die eigentliche Quelle —
  // also lesen statt ablehnen.
  if (/pdf/i.test(typ) || (!typ && /\.pdf($|\?)/i.test(url))) {
    const daten = Buffer.from(await antwort.arrayBuffer())
    if (daten.length > 15 * 1024 * 1024) throw new RechercheFehler('Dieses PDF ist zu groß.')
    const { textAusDatei } = await import('../kontext')
    const { text } = await textAusDatei('seite.pdf', daten)
    if (text.trim().length < 80) throw new RechercheFehler('Dieses PDF enthält kaum lesbaren Text.')
    return text.slice(0, opts.zeichen ?? 6000)
  }
  if (typ && !/text|html|json|xml/i.test(typ)) throw new RechercheFehler('Diese Seite ist kein Text.', typ)
  const text = textAusHtml(await antwort.text())
  if (text.length < 80) throw new RechercheFehler('Diese Seite enthält kaum Text.')
  return text.slice(0, opts.zeichen ?? 6000)
}
