/** Eigene, schlanke SVG-Zeichen (Strichstärke einheitlich, currentColor). */
import type { SVGProps } from 'react'
import { FLAMME_AUSSEN, FLAMME_KERN, SCHALE_BOGEN, SCHALE_RAND } from '@shared/marke'

type P = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 16, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)
export const IconMinus = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
)
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)
/** Zwei einander zugewandte Ecken: ausbreiten und wieder einengen. */
/** Sonnenaufgang — der Morgen unter den Vorschlägen. */
export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="13" r="4" />
    <path d="M12 4v2M5 13H3M21 13h-2M12 22v-1M6.4 7.4 5 6M17.6 7.4 19 6" />
  </Svg>
)
/** Ablagekorb für eingegangene Mitteilungen. */
export const IconTray = (p: P) => (
  <Svg {...p}>
    <path d="M4 13h4l1 2h6l1-2h4" />
    <path d="M4 13 6 5h12l2 8v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
  </Svg>
)
/** Kalenderblatt. */
export const IconCalendar = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="6" width="16" height="14" rx="2" />
    <path d="M4 10h16M9 4v4M15 4v4" />
  </Svg>
)
/** Liste mit Haken — der Rückblick. */
export const IconChecklist = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h10M4 12h10M4 17h7" />
    <path d="M17 6.5 18.5 8 21 5.5M17 16.5 18.5 18 21 15.5" />
  </Svg>
)
/** Glühlampe für Einfälle. */
export const IconBulb = (p: P) => (
  <Svg {...p}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3 11.2V18h6v-3.8A6 6 0 0 0 12 3z" />
  </Svg>
)
/** Fernglas: ein Thema behalten. */
export const IconBinoculars = (p: P) => (
  <Svg {...p}>
    <path d="M9 4h2v9H7.5A3.5 3.5 0 1 0 9 4zM15 4h-2v9h3.5A3.5 3.5 0 1 1 15 4z" />
    <path d="M11 8h2" />
  </Svg>
)
/** Auf- und absteigende Pfeile: sortieren. */
export const IconSort = (p: P) => (
  <Svg {...p}>
    <path d="M7 4v16M4 7l3-3 3 3" />
    <path d="M17 20V4M14 17l3 3 3-3" />
  </Svg>
)
/** Code-Klammern. */
export const IconCode = (p: P) => (
  <Svg {...p}>
    <path d="M9 7 4 12l5 5M15 7l5 5-5 5" />
  </Svg>
)
/** Blatt mit gelegter Ecke — das Zeichen für eine Datei. */
export const IconFile = (p: P) => (
  <Svg {...p}>
    <path d="M14 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" />
    <path d="M14 4v5h5" />
  </Svg>
)
export const IconExpand = (p: P) => (
  <Svg {...p}>
    <path d="M9 5H5v4M15 19h4v-4" />
    <path d="M5 5l5 5M19 19l-5-5" />
  </Svg>
)
export const IconSquare = (p: P) => (
  <Svg {...p}>
    <rect x="5.5" y="5.5" width="13" height="13" rx="2" />
  </Svg>
)
export const IconChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="M6 9.5l6 6 6-6" />
  </Svg>
)
export const IconChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="M9.5 6l6 6-6 6" />
  </Svg>
)
export const IconBack = (p: P) => (
  <Svg {...p}>
    <path d="M14.5 6l-6 6 6 6" />
  </Svg>
)
/** Kreispfeil: noch einmal antworten. */
export const IconRetry = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v3.2h3.2" />
  </Svg>
)
export const IconForward = (p: P) => (
  <Svg {...p}>
    <path d="M9.5 6l6 6-6 6" />
  </Svg>
)
export const IconPanel = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M10 4.5v15" />
  </Svg>
)
export const IconFolder = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 7.5a2 2 0 0 1 2-2h3.2l1.8 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </Svg>
)
export const IconLayers = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5l8 4.5-8 4.5L4 8z" />
    <path d="M4 12.5l8 4.5 8-4.5" />
  </Svg>
)
export const IconSpark = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
  </Svg>
)
export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
)
export const IconSendUp = (p: P) => (
  <Svg {...p}>
    <path d="M12 19V6M6.5 11.5L12 6l5.5 5.5" />
  </Svg>
)
export const IconStopSquare = (p: P) => (
  <Svg {...p} fill="currentColor" strokeWidth={0}>
    <rect x="7" y="7" width="10" height="10" rx="2" />
  </Svg>
)
export const IconPaperclip = (p: P) => (
  <Svg {...p}>
    <path d="M20 11.5l-8 8a4.6 4.6 0 0 1-6.5-6.5l8.2-8.2a3.1 3.1 0 0 1 4.4 4.4l-8.2 8.2a1.6 1.6 0 0 1-2.2-2.2l7.5-7.5" />
  </Svg>
)
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="M15 15l4.5 4.5" />
  </Svg>
)
export const IconSliders = (p: P) => (
  <Svg {...p}>
    <path d="M5 8h11M19 8h.01M5 16h4M12 16h7" />
    <circle cx="17.5" cy="8" r="1.8" />
    <circle cx="10.5" cy="16" r="1.8" />
  </Svg>
)
export const IconGlobe = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7.5" />
    <path d="M4.5 12h15M12 4.5c2.2 2.4 2.2 12.6 0 15-2.2-2.4-2.2-12.6 0-15z" />
  </Svg>
)
export const IconKeyboard = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="7" width="18" height="11" rx="2.2" />
    <path d="M7 10.5h.01M10.5 10.5h.01M14 10.5h.01M17 10.5h.01M7 14h10" />
  </Svg>
)
export const IconCpu = (p: P) => (
  <Svg {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
    <rect x="10" y="10" width="4" height="4" rx="1" />
    <path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3" />
  </Svg>
)
export const IconBox = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.8l7.5 4v8.4l-7.5 4-7.5-4V7.8z" />
    <path d="M4.7 7.9L12 11.8l7.3-3.9M12 11.8v8.4" />
  </Svg>
)
export const IconShield = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.8l6.5 2.4v5.4c0 4-2.7 6.8-6.5 8.2-3.8-1.4-6.5-4.2-6.5-8.2V6.2z" />
    <path d="M9.4 12l1.9 2 3.4-3.6" />
  </Svg>
)
export const IconPin = (p: P) => (
  <Svg {...p}>
    <path d="M12 17v4M8.5 4h7l-1 6.5 2 2.5H7.5l2-2.5z" />
  </Svg>
)
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 7h15M9 7V5h6v2M6.5 7l1 12h9l1-12" />
  </Svg>
)
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
)
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="9" width="10.5" height="10.5" rx="2" />
    <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
  </Svg>
)
export const IconBolt = (p: P) => (
  <Svg {...p}>
    <path d="M13 3l-7 10h5l-1 8 7-10h-5z" />
  </Svg>
)
export const IconGrid = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Svg>
)
export const IconDots = (p: P) => (
  <Svg {...p}>
    <circle cx="6" cy="12" r="1.4" fill="currentColor" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    <circle cx="18" cy="12" r="1.4" fill="currentColor" />
  </Svg>
)

/**
 * Das Zeichen von Hestia: die Herdschale. Überall dasselbe — Titelleiste,
 * Startseite, Antworten, Handy, PDF und App-Symbol.
 *
 * Mit `active` flackert die Flamme, solange das Modell denkt oder schreibt;
 * die Schale steht still. Die Gruppen bestehen immer — die Ruhe kommt aus dem
 * Stil, nicht aus dem Verschwinden, damit meßbar bleibt, daß es stillsteht.
 */
export function LogoMark({ size = 26, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg
      className={active ? 'logo-mark logo-mark--active' : 'logo-mark'}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="14.5" fill="currentColor" opacity="0.1" />
      <g className="logo-mark__ember">
        <path d={FLAMME_AUSSEN} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path className="logo-mark__kern" d={FLAMME_KERN} fill="currentColor" />
      </g>
      <path d={SCHALE_BOGEN} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d={SCHALE_RAND} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

/** Datei außerhalb öffnen (Pfeil aus Kasten). */
export function IconExternal({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 5h5v5M19 5l-8 8" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </svg>
  )
}

/** Speichern unter (Pfeil in Schale). */
export function IconDownload({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11M8 11l4 4 4-4M5 20h14" />
    </svg>
  )
}

/** Umbenennen (Stift). */
export function IconPencil({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20z" />
      <path d="M13.5 6.5l3.5 3.5" />
    </svg>
  )
}

/** Tacho für die Durchsatzanzeige. */
export function IconGauge({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M4 16a8 8 0 1 1 16 0" />
      <path d="M12 16l4-5" />
    </svg>
  )
}

/** Telefon in Hochformat (für den Handy-Zugang). */
export function IconPhone({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="7" y="2.5" width="10" height="19" rx="2.6" />
      <path d="M10.5 18.5h3" />
    </svg>
  )
}

/** Hand hoch: erst fragen (Zugriffsstufe „manuell"). */
export function IconHand({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M12 10.5V4.8a1.5 1.5 0 0 1 3 0V11" />
      <path d="M15 11V6.8a1.5 1.5 0 0 1 3 0V14a6.5 6.5 0 0 1-6.5 6.5h-.4A5.6 5.6 0 0 1 5.5 15L4 12.3a1.4 1.4 0 0 1 2.3-1.6L9 13.5" />
    </svg>
  )
}

/** Häkchen im Kreis: schreibt ohne Rückfrage (Zugriffsstufe „automatisch"). */
export function IconCheckCircle({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </svg>
  )
}

/** Ausruf im Dreieck: fragt gar nichts mehr (Zugriffsstufe „überspringen"). */
export function IconAlert({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4.5l8 14.5H4l8-14.5z" />
      <path d="M12 10v4" />
      <path d="M12 16.6v.2" />
    </svg>
  )
}

/** Pausenstrich: einen Zeitplan anhalten. */
export const IconPause = (p: P) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M9.5 6v12M14.5 6v12" />
  </svg>
)

/** Dreieck: einen Zeitplan fortsetzen oder sofort laufen lassen. */
export const IconPlay = (p: P) => (
  <svg width={p.size ?? 16} height={p.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 5.5l11 6.5-11 6.5v-13z" />
  </svg>
)

export const IconMic = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Svg>
)
