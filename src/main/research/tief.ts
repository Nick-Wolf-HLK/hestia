/**
 * Die Tiefenrecherche: planen, breit suchen, jede Quelle auswerten, Lücken
 * schließen — und erst dann den Bericht schreiben lassen.
 *
 * Anders als die Websuche ist das kein einzelnes Werkzeug, das das Modell
 * nebenbei ruft, sondern ein fester Ablauf in Runden:
 *
 *   1. Plan      — das Modell zerlegt die Frage in Teilfragen mit Suchanfragen
 *   2. Suchen    — alle Anfragen, Treffer gesammelt, Doppeltes aussortiert
 *   3. Auswerten — Seiten ganz lesen, das Modell zieht je Seite die Fakten heraus
 *   4. Lücken    — was fehlt noch? Neue Anfragen, zweite Runde
 *
 * Heraus kommt eine nummerierte Quellensammlung mit Notizen. Den Bericht
 * schreibt danach der normale Lauf — mit genau diesen Nummern.
 */
import { RechercheFehler, leseSeite, suchen, type Fund } from './web'
import { anfragenBildern } from './index'

/** Eine Frage ans Modell, ohne Werkzeuge; die Antwort als Text. */
export type ModellFrage = (system: string, nutzer: string, opts?: { maxTokens?: number; signal?: AbortSignal }) => Promise<string>

/** Sichtbare Schritte in der Zeitlinie. */
export interface Schritte {
  beginn(tool: string, args: Record<string, unknown>): string
  ende(id: string, tool: string, ok: boolean, output: string): void
}

export interface TiefOptionen {
  fragModell: ModellFrage
  schritte: Schritte
  signal?: AbortSignal
  /** Pause zwischen zwei Suchen in ms (Suchmaschinen bremsen sonst). */
  suchPause?: number
  /** Wartezeiten, wenn die Suchmaschine trotzdem bremst. */
  bremsPausen?: number[]
  /** Heutiges Datum als Text — sonst sucht das Modell nach „aktuell“ im Jahr seines Trainings. */
  heute?: string
  /** Suchanfragen der ersten Runde, höchstens. */
  anfragenHoechstens?: number
  /** Seiten der ersten Runde. */
  seitenErsteRunde?: number
  /** Seiten der Lückenrunde. */
  seitenLueckenrunde?: number
}

export interface Teilfrage {
  frage: string
  suchen: string[]
}

export interface Quelle {
  nummer: number
  titel: string
  url: string
  teilfrage: number
  notizen: string
}

export interface TiefErgebnis {
  frage: string
  teilfragen: Teilfrage[]
  quellen: Quelle[]
  suchen: number
  gelesen: number
  fehler: string[]
}

/** Das erste JSON-Objekt aus einer Modellantwort — Modelle umrahmen es gern mit Text oder ```json. */
export function jsonAus<T>(text: string): T | undefined {
  const ohne = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  const anfang = ohne.indexOf('{')
  if (anfang < 0) return undefined
  let tiefe = 0
  let inText = false
  for (let i = anfang; i < ohne.length; i++) {
    const z = ohne[i]
    if (inText) {
      if (z === '\\') i++
      else if (z === '"') inText = false
      continue
    }
    if (z === '"') inText = true
    else if (z === '{') tiefe++
    else if (z === '}' && --tiefe === 0) {
      try {
        return JSON.parse(ohne.slice(anfang, i + 1)) as T
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

/** Plan aus der Modellantwort lesen; ohne brauchbaren Plan: Anfragen aus der Frage selbst. */
export function planLesen(antwort: string, frage: string, hoechstens: number): Teilfrage[] {
  const roh = jsonAus<{ teilfragen?: Array<{ frage?: unknown; suchen?: unknown }> }>(antwort)
  const teilfragen = (roh?.teilfragen ?? [])
    .map((t) => ({
      frage: typeof t.frage === 'string' ? t.frage.trim() : '',
      suchen: Array.isArray(t.suchen) ? t.suchen.filter((s): s is string => typeof s === 'string' && s.trim().length > 2).map((s) => s.trim()) : []
    }))
    .filter((t) => t.frage && t.suchen.length > 0)
    .slice(0, 7)
  if (teilfragen.length === 0) return [{ frage, suchen: anfragenBildern(frage, hoechstens) }]
  // Gleichmäßig kürzen: jede Teilfrage behält mindestens eine Anfrage.
  let gesamt = teilfragen.reduce((n, t) => n + t.suchen.length, 0)
  while (gesamt > hoechstens) {
    const laengste = teilfragen.reduce((a, b) => (b.suchen.length > a.suchen.length ? b : a))
    if (laengste.suchen.length <= 1) break
    laengste.suchen.pop()
    gesamt--
  }
  return teilfragen
}

/**
 * Welche Seiten gelesen werden: reihum aus den Teilfragen, jede Adresse einmal,
 * höchstens zwei Seiten derselben Website — sonst belegt eine Quelle alles.
 */
export function seitenWaehlen(funde: Array<Fund & { teilfrage: number }>, anzahl: number, schonGelesen: Set<string>): Array<Fund & { teilfrage: number }> {
  const jeTeilfrage = new Map<number, Array<Fund & { teilfrage: number }>>()
  for (const fund of funde) {
    if (schonGelesen.has(fund.url)) continue
    const liste = jeTeilfrage.get(fund.teilfrage) ?? []
    if (!liste.some((f) => f.url === fund.url)) liste.push(fund)
    jeTeilfrage.set(fund.teilfrage, liste)
  }
  const gewaehlt: Array<Fund & { teilfrage: number }> = []
  const jeSeite = new Map<string, number>()
  const urls = new Set<string>()
  const warteschlangen = [...jeTeilfrage.values()]
  while (gewaehlt.length < anzahl && warteschlangen.some((w) => w.length > 0)) {
    for (const w of warteschlangen) {
      const fund = w.shift()
      if (!fund || urls.has(fund.url)) continue
      let host: string
      try {
        host = new URL(fund.url).hostname.replace(/^www\./, '')
      } catch {
        continue
      }
      if ((jeSeite.get(host) ?? 0) >= 2) continue
      jeSeite.set(host, (jeSeite.get(host) ?? 0) + 1)
      urls.add(fund.url)
      gewaehlt.push(fund)
      if (gewaehlt.length >= anzahl) break
    }
  }
  return gewaehlt
}

const PLAN_SYSTEM = (heute: string): string =>
  `Du planst eine gründliche Web-Recherche. Heute ist ${heute}. ` +
  'Zerlege die Frage in 3 bis 6 Teilfragen, die zusammen eine vollständige Antwort ergeben (Hintergrund, Fakten und Zahlen, aktuelle Entwicklungen, ' +
  'verschiedene Sichtweisen, offene Punkte — je nach Thema). Gib je Teilfrage 2 bis 4 kurze, verschiedene Suchanfragen an, wie man sie in eine ' +
  'Suchmaschine tippt (Stichwörter, keine Sätze; wo sinnvoll auch auf Englisch). ' +
  'Antworte NUR mit JSON in genau dieser Form: {"teilfragen":[{"frage":"…","suchen":["…","…"]}]}'

const AUSWERTUNG_SYSTEM = 'Du bist Rechercheassistent. Du bekommst den Text einer Webseite und eine Rechercheaufgabe und ziehst die Fakten heraus, die zur Aufgabe passen.'

/**
 * Die Auswertungsaufgabe steht **hinter** dem Seitentext: Lokale Modelle halten
 * sich an das, was zuletzt kam. Stand sie davor, und „sonst IRRELEVANT“ war ein
 * bequemer Ausweg, meldete das Modell 23 von 24 passenden Seiten als unbrauchbar.
 */
export function auswertungsAufgabe(frage: string, teilfrage: string): string {
  return (
    `AUFGABE: Recherche zur Frage „${frage}“ (Teilfrage: ${teilfrage}).\n` +
    'Schreibe alle passenden Fakten aus der Webseite oben als Stichpunkte auf: Zahlen, Prozentsätze, Beträge, Daten, Namen, Bedingungen, Fristen, ' +
    'Änderungen und Aussagen — knapp und genau so, wie sie auf der Seite stehen; wichtige Aussagen gern als kurzes Zitat. Nenne den Stand bzw. das ' +
    'Datum der Information, wenn angegeben. Nur wenn die Seite gar nichts zum Thema enthält (Fehlerseite, Anmeldeseite, reine Navigation), ' +
    'antworte mit dem einen Wort IRRELEVANT, ohne Erklärung.'
  )
}

/**
 * Den Inhalt einer Seite vom Drumherum trennen: Menüpunkte, Fußzeilen und
 * Knöpfe sind kurze Zeilen ohne Satzzeichen und ohne Zahl. Wer sie nicht
 * herausnimmt, gibt dem Modell tausende Zeichen Navigation vor dem Artikel.
 */
export function seitenKern(text: string): string {
  return text
    .split('\n')
    .map((zeile) => zeile.trim())
    .filter((zeile) => zeile.length >= 60 || (zeile.length >= 25 && /[.:;!?]|\d/.test(zeile)))
    .join('\n')
}

const LUECKEN_SYSTEM = (heute: string): string =>
  `Du prüfst eine laufende Recherche auf Lücken. Heute ist ${heute}. Unten stehen die Teilfragen und was bisher gefunden wurde. ` +
  'Welche Teilfragen sind schwach oder gar nicht belegt, wo widersprechen sich Quellen, was fehlt Wichtiges? ' +
  'Gib 2 bis 6 neue, gezielte Suchanfragen an, die diese Lücken schließen (Stichwörter, keine Sätze). Ist alles gut belegt, gib eine leere Liste. ' +
  'Antworte NUR mit JSON: {"luecken":"kurze Begründung","suchen":["…"]}'

const warte = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const uhr = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(uhr)
      reject(Object.assign(new Error('abgebrochen'), { name: 'AbortError' }))
    }, { once: true })
  })

/**
 * Suchen mit Geduld: Die Suchmaschine bremst, wenn zu viele Anfragen dicht
 * hintereinander kommen. Dann warten und noch einmal — statt die halbe
 * Recherche mit „bremst gerade“ zu verlieren.
 */
async function geduldigSuchen(anfrage: string, signal?: AbortSignal, pausen = [6000, 15000, 30000]): Promise<Fund[]> {
  for (let versuch = 0; ; versuch++) {
    try {
      return await suchen(anfrage, { höchste: 6, signal })
    } catch (e) {
      const bremst = e instanceof RechercheFehler && /bremst|prüfung/i.test(e.message)
      if (!bremst || versuch >= pausen.length || signal?.aborted) throw e
      await warte(pausen[versuch]!, signal)
    }
  }
}

/** Ein kompletter Recherchelauf. Wirft bei Abbruch (AbortError) — der Lauf fängt das. */
export async function tiefenrecherche(frage: string, opts: TiefOptionen): Promise<TiefErgebnis> {
  const heute = opts.heute ?? new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
  const signal = opts.signal
  const fehler: string[] = []
  const quellen: Quelle[] = []
  const gelesen = new Set<string>()
  let suchZahl = 0
  const abgebrochen = (): void => {
    if (signal?.aborted) throw Object.assign(new Error('abgebrochen'), { name: 'AbortError' })
  }

  // 1. Plan
  const planId = opts.schritte.beginn('tiefenrecherche_plan', { frage })
  let teilfragen: Teilfrage[]
  try {
    const antwort = await opts.fragModell(PLAN_SYSTEM(heute), frage, { maxTokens: 1200, signal })
    teilfragen = planLesen(antwort, frage, opts.anfragenHoechstens ?? 18)
    opts.schritte.ende(planId, 'tiefenrecherche_plan', true, teilfragen.map((t, i) => `${i + 1}. ${t.frage}`).join('\n'))
  } catch (e) {
    abgebrochen()
    teilfragen = [{ frage, suchen: anfragenBildern(frage, 4) }]
    opts.schritte.ende(planId, 'tiefenrecherche_plan', false, `Kein Plan vom Modell (${(e as Error).message}) — suche mit der Frage selbst.`)
  }

  // 2.–3. Suchen, lesen, auswerten — einmal für den Plan, einmal für die Lücken.
  const runde = async (anfragen: Array<{ anfrage: string; teilfrage: number }>, seiten: number): Promise<void> => {
    const funde: Array<Fund & { teilfrage: number }> = []
    for (const [nr, { anfrage, teilfrage }] of anfragen.entries()) {
      abgebrochen()
      if (nr > 0) await warte(opts.suchPause ?? 1500, signal)
      const id = opts.schritte.beginn('websuche', { anfrage })
      try {
        const treffer = await geduldigSuchen(anfrage, signal, opts.bremsPausen)
        suchZahl++
        funde.push(...treffer.map((t) => ({ ...t, teilfrage })))
        opts.schritte.ende(id, 'websuche', true, `${treffer.length} Treffer`)
      } catch (e) {
        abgebrochen()
        const grund = e instanceof RechercheFehler ? e.message : String((e as Error).message)
        fehler.push(`Suche „${anfrage}“: ${grund}`)
        opts.schritte.ende(id, 'websuche', false, grund)
      }
    }

    for (const fund of seitenWaehlen(funde, seiten, gelesen)) {
      abgebrochen()
      gelesen.add(fund.url)
      const id = opts.schritte.beginn('webseite_lesen', { url: fund.url })
      try {
        const text = seitenKern(await leseSeite(fund.url, { zeichen: 60000, signal })).slice(0, 12000)
        const teil = teilfragen[fund.teilfrage]?.frage ?? frage
        const notizen = await opts.fragModell(
          AUSWERTUNG_SYSTEM,
          `WEBSEITE: ${fund.titel}\n${fund.url}\n\n${text}\n\n---\n${auswertungsAufgabe(frage, teil)}`,
          { maxTokens: 700, signal }
        )
        const sauber = notizen.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
        if (!sauber) {
          // Kein Text ist keine Aussage über die Seite — sondern ein Fehler beim Modell.
          fehler.push(`${fund.url}: Das Modell lieferte keine Auswertung.`)
          opts.schritte.ende(id, 'webseite_lesen', false, 'Keine Auswertung vom Modell')
          continue
        }
        if (/^IRRELEVANT\b/i.test(sauber)) {
          opts.schritte.ende(id, 'webseite_lesen', true, 'nichts Brauchbares')
          continue
        }
        quellen.push({ nummer: quellen.length + 1, titel: fund.titel, url: fund.url, teilfrage: fund.teilfrage, notizen: sauber.slice(0, 2500) })
        opts.schritte.ende(id, 'webseite_lesen', true, `Quelle [${quellen.length}] ausgewertet`)
      } catch (e) {
        abgebrochen()
        const grund = e instanceof RechercheFehler ? e.message : String((e as Error).message)
        fehler.push(`${fund.url}: ${grund}`)
        opts.schritte.ende(id, 'webseite_lesen', false, grund)
      }
    }
  }

  await runde(
    teilfragen.flatMap((t, i) => t.suchen.map((anfrage) => ({ anfrage, teilfrage: i }))),
    opts.seitenErsteRunde ?? 16
  )

  // 4. Lücken
  abgebrochen()
  const lueckenId = opts.schritte.beginn('tiefenrecherche_luecken', { frage })
  let neue: string[] = []
  try {
    const stand = teilfragen
      .map((t, i) => {
        const belege = quellen.filter((q) => q.teilfrage === i)
        return `Teilfrage ${i + 1}: ${t.frage}\n${belege.length ? belege.map((q) => `- [${q.nummer}] ${q.notizen.slice(0, 400).replace(/\n+/g, ' ')}`).join('\n') : '- (noch nichts gefunden)'}`
      })
      .join('\n\n')
    const antwort = await opts.fragModell(LUECKEN_SYSTEM(heute), `Frage: ${frage}\n\n${stand}`, { maxTokens: 800, signal })
    const roh = jsonAus<{ luecken?: unknown; suchen?: unknown }>(antwort)
    neue = (Array.isArray(roh?.suchen) ? roh.suchen : []).filter((s): s is string => typeof s === 'string' && s.trim().length > 2).slice(0, 6)
    opts.schritte.ende(lueckenId, 'tiefenrecherche_luecken', true, neue.length ? `${typeof roh?.luecken === 'string' ? roh.luecken : 'Lücken gefunden'} — ${neue.length} neue Suchen` : 'Keine wesentlichen Lücken')
  } catch (e) {
    abgebrochen()
    opts.schritte.ende(lueckenId, 'tiefenrecherche_luecken', false, (e as Error).message)
  }
  if (neue.length > 0) {
    // Die Lückenanfragen gehören keiner Teilfrage fest an — der ersten mit den wenigsten Belegen.
    const schwach = teilfragen.map((_, i) => ({ i, n: quellen.filter((q) => q.teilfrage === i).length })).sort((a, b) => a.n - b.n)[0]?.i ?? 0
    await runde(neue.map((anfrage) => ({ anfrage, teilfrage: schwach })), opts.seitenLueckenrunde ?? 8)
  }

  if (quellen.length === 0) {
    throw new RechercheFehler('Die Tiefenrecherche hat keine brauchbare Quelle gefunden.', fehler.slice(0, 5).join(' | '))
  }
  return { frage, teilfragen, quellen, suchen: suchZahl, gelesen: gelesen.size, fehler }
}

/** Das Ergebnis als Grundlage für den Bericht: Teilfragen, nummerierte Quellen mit Notizen. */
export function tiefGrundlage(e: TiefErgebnis): string {
  const plan = e.teilfragen.map((t, i) => `${i + 1}. ${t.frage}`).join('\n')
  const quellen = e.quellen.map((q) => `[${q.nummer}] ${q.titel} — ${q.url}\n(zu Teilfrage ${q.teilfrage + 1})\n${q.notizen}`).join('\n\n---\n\n')
  const verzeichnis = e.quellen.map((q) => `[${q.nummer}] ${q.titel} — ${q.url}`).join('\n')
  return (
    `Tiefenrecherche zu: ${e.frage}\n${e.suchen} Suchanfragen, ${e.gelesen} Seiten gelesen, ${e.quellen.length} Quellen ausgewertet.\n\n` +
    `Teilfragen:\n${plan}\n\nNotizen je Quelle:\n\n${quellen}\n\nQuellenverzeichnis:\n${verzeichnis}`
  )
}
