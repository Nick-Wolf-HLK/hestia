/**
 * Zentrale Marken-Konfiguration.
 *
 * EINZIGER Ort, an dem Produktname, Akzentfarbe und Icon-Identität stehen.
 * Umbenennen = diese Datei anpassen (+ package.json::name, electron-builder.yml,
 * build/icon.png) und einmal die Datenpfad-Wanderung in db.ts prüfen.
 *
 * Namenswahl: Hestia, die griechische Göttin von Herd und Zuhause. Die App hält
 * sich wörtlich daran: Modelle laufen auf dem eigenen Rechner, die Arbeit
 * passiert in einem selbst gewählten Ordner. Das Zeichen ist die Herdglut.
 */

export const branding = {
  /** Vollständiger Anzeigename im UI. */
  name: 'Hestia',
  /** Kurztitel für Fensterleisten und Menüs. */
  shortName: 'Hestia',
  /** Technischer Bezeichner für Paket, Desktop-Datei und WM_CLASS. */
  appId: 'com.local.hestia',
  /** Präfix für interne Protokolle (hestia://…) und Paketnamen. */
  protocolScheme: 'hestia',
  /** Kurzbeschreibung für Paket-Metadaten und About-Bereich. */
  tagline: 'Lokale Modelle. Chat und Agent im eigenen Ordner.',
  /** Akzentfarbe — wie die alte Glut; Rest der Palette in styles/tokens.css. */
  accent: {
    light: '#C2703D',
    dark: '#D9834E'
  },
  /** Copyright-Zeile im About-Bereich. */
  copyright: 'Entwickelt von ScaleWise',
  /** Webseite des Herausgebers und Quellcode. */
  webseite: 'https://www.scalewise-ai.de',
  quellcode: 'https://github.com/Nick-Wolf-HLK/hestia'
} as const

export type Branding = typeof branding

/** Begrüßung nach Tageszeit (bewusst eigene Formulierung). */
export function greetingFor(date: Date, name?: string): string {
  const h = date.getHours()
  const part = h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend'
  return name ? `${part}, ${name}` : part
}
