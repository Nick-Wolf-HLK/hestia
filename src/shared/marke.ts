/**
 * Die Herdschale — das einzige Zeichen von Hestia: eine Flamme in der
 * Feuerschale, wie die Antike Hestias Herd zeigte.
 *
 * Hier liegt die Zeichnung einmal für alle, die sie brauchen: die Oberfläche,
 * die Handy-Seite und das Deckblatt eines PDF. App-Symbol und Leistensymbol
 * sind daraus gerendert (build/icon.svg, build/tray.svg).
 *
 * Getrennt in Flamme und Schale, damit sich beim Arbeiten nur die Flamme
 * bewegt. Raster 32 × 32, Linien in `currentColor`.
 */
export const FLAMME_AUSSEN = 'M16 7.6c2.3 3 3.8 4.6 3.8 6.9a3.8 3.8 0 0 1-7.6 0c0-2.3 1.5-3.9 3.8-6.9z'
export const FLAMME_KERN = 'M16 13c1 1.3 1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 .5-1.7 1.5-3z'
export const SCHALE_BOGEN = 'M9.5 18.6a6.5 6.5 0 0 0 13 0'
export const SCHALE_RAND = 'M9 18.6h14'

/** Die Herdschale als fertiges SVG — für Seiten ohne React. */
export function herdschaleSvg(groesse: number, farbe = 'currentColor', strich = 1.7): string {
  const linie = `fill="none" stroke="${farbe}" stroke-width="${strich}" stroke-linecap="round" stroke-linejoin="round"`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${groesse}" height="${groesse}" viewBox="0 0 32 32" aria-hidden="true">` +
    `<path d="${FLAMME_AUSSEN}" ${linie}/><path d="${FLAMME_KERN}" fill="${farbe}"/>` +
    `<path d="${SCHALE_BOGEN}" ${linie}/><path d="${SCHALE_RAND}" ${linie}/></svg>`
  )
}
