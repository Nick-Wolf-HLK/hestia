/**
 * Die Tiefere Recherche: breit sammeln, belegt melden.
 *
 * Bewusst ein **Werkzeug**, kein zweiter Assistent. Der Lauf plant weiter der
 * Agent; dieses Werkzeug bringt ihm die Funde — aus mehreren Anfragen, aus
 * gelesenen Seiten, mit der Adresse an jedem einzelnen. Was ohne Adresse dasteht,
 * ist keine Quelle, und das sieht er dann auch so.
 */
import { RechercheFehler, leseSeite, suchen, type Fund } from './web'

export interface Notiz {
  anfrage: string
  fund: Fund
  auszug: string
}

export interface RechercheErgebnis {
  fragen: string[]
  notizen: Notiz[]
  gemeldeteFehler: string[]
}

/**
 * Anfragen aus einer Frage bauen.
 *
 * Kein Modell dafür: die Frage selbst, ohne Anrede und Füllwort, dazu eine
 * knappe Stichwortzeile und, wenn etwas übrig bleibt, eine engere Fassung.
 * Eine Modellplanung würde hier vor allem Zeit kosten, die Suche ändert sie
 * selten zum Guten.
 */
export function anfragenBildern(frage: string, höchste = 4): string[] {
  const sauber = frage.replace(/\s+/g, ' ').trim()
  const aus = new Set<string>()
  aus.add(sauber)
  const stichworter = sauber
    .replace(/^(recherchiere|recherche|untersuche|finde( heraus)?|was wei[ßt] du über)\s*/i, '')
    .replace(/^\s*[:,-]?\s*(bitte|doch|mal|mir|kurz)\b/gi, '')
    .replace(/^[\s:,-]+/g, '')
    .replace(/[?.!]+$/g, '')
    .trim()
  if (stichworter && stichworter !== sauber) aus.add(stichworter)
  const wörter = stichworter.split(' ').filter((wort) => wort.length > 3)
  if (wörter.length >= 4) aus.add(wörter.slice(0, Math.min(6, Math.ceil(wörter.length / 2))).join(' '))
  if (stichworter.split(' ').length >= 3) aus.add(`"${stichworter}"`)
  return [...aus].filter((eintrag) => eintrag.length > 2).slice(0, höchste)
}

/**
 * Ein Recherchelauf: Anfragen stellen, verschiedene Seiten lesen, Notizen machen.
 *
 * Die Suchmaschine wird dünn gefragt (eine Anfrage nach der anderen, mit Pause),
 * und jede Seite kommt höchstens einmal vor — drei Funde aus einem Text sind
 * keine drei Belege.
 */
export async function recherchiere(
  frage: string,
  opts: {
    seitenHöchstzahl?: number
    zeichenProSeite?: number
    fortschritt?: (punkte: { text: string; done: boolean }[]) => void
    signal?: AbortSignal
  } = {}
): Promise<RechercheErgebnis> {
  const fragen = anfragenBildern(frage)
  const höchstSeiten = opts.seitenHöchstzahl ?? 6
  const notizen: Notiz[] = []
  const gemeldeteFehler: string[] = []
  const gelesen = new Set<string>()
  const punkte: { text: string; done: boolean }[] = fragen.map((anfrage) => ({ text: `Suchen: ${anfrage}`, done: false }))
  opts.fortschritt?.(punkte.map((punkt) => ({ ...punkt })))

  const fische: Fund[] = []
  for (const [zahl, anfrage] of fragen.entries()) {
    try {
      const treffer = await suchen(anfrage, { höchste: 5, signal: opts.signal })
      fische.push(...treffer)
    } catch (fehler) {
      gemeldeteFehler.push(`${anfrage}: ${fehler instanceof RechercheFehler ? fehler.message : String(fehler)}`)
      // Die erste Anfrage ist die wichtigste: ohne sie bringt der Lauf nichts.
      if (zahl === 0 && fische.length === 0) throw fehler
    }
    punkte[zahl] = { ...punkte[zahl]!, done: true }
    opts.fortschritt?.(punkte.map((punkt) => ({ ...punkt })))
  }

  if (fische.length === 0) {
    throw new RechercheFehler('Keine Fundstelle gefunden.', gemeldeteFehler.join(' | '))
  }

  const geordnet = fische.filter((fund, index, alle) => alle.findIndex((anderer) => anderer.url === fund.url) === index)
  const zähler = Math.min(höchstSeiten, geordnet.length)
  punkte.push({ text: `${zähler} Seiten lesen`, done: false })
  opts.fortschritt?.(punkte.map((punkt) => ({ ...punkt })))

  for (const fund of geordnet.slice(0, zähler)) {
    if (gelesen.has(fund.url)) continue
    try {
      const text = await leseSeite(fund.url, { zeichen: opts.zeichenProSeite ?? 5000, signal: opts.signal })
      gelesen.add(fund.url)
      notizen.push({ anfrage: fund.text || fund.titel, fund, auszug: text })
    } catch (fehler) {
      gemeldeteFehler.push(`${fund.url}: ${fehler instanceof RechercheFehler ? fehler.message : String(fehler)}`)
    }
  }
  punkte[punkte.length - 1] = { ...punkte[punkte.length - 1]!, done: true }
  opts.fortschritt?.(punkte.map((punkt) => ({ ...punkt })))

  if (notizen.length === 0) {
    throw new RechercheFehler('Keine Seite war zu lesen.', gemeldeteFehler.join(' | '))
  }
  return { fragen, notizen, gemeldeteFehler }
}

/** Das Ergebnis als Text für den Lauf: Notizen mit Nummer und Adresse. */
export function berichtGrundlage(ergebnis: RechercheErgebnis, zeichenProNotiz = 1600): string {
  const quellen = new Map<string, { nummer: number; titel: string; url: string }>()
  const teile = ergebnis.notizen.map((notiz) => {
    const bekannte = quellen.get(notiz.fund.url)
    const nummer = bekannte?.nummer ?? quellen.size + 1
    quellen.set(notiz.fund.url, { nummer, titel: notiz.fund.titel, url: notiz.fund.url })
    return `[${nummer}] ${notiz.fund.titel} — ${notiz.fund.url}\n${notiz.auszug.slice(0, zeichenProNotiz)}`
  })
  const verzeichnis = [...quellen.values()]
    .sort((a, b) => a.nummer - b.nummer)
    .map((quelle) => `[${quelle.nummer}] ${quelle.titel} — ${quelle.url}`)
    .join('\n')
  const fehler = ergebnis.gemeldeteFehler.length ? `\n\nNicht gelesen:\n${ergebnis.gemeldeteFehler.map((grund) => `- ${grund}`).join('\n')}` : ''
  return `Anfragen: ${ergebnis.fragen.join(' | ')}\n\n${teile.join('\n\n---\n\n')}\n\nQuellenverzeichnis:\n${verzeichnis}${fehler}`
}
