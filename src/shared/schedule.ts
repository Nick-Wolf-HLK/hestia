/**
 * Zeitpläne für geplante Aufträge.
 *
 * Alles rechnet in der lokalen Zeitzone des Rechners, weil die Menschen ihre
 * Termine so denken („morgens um halb acht"). Die Funktionen sind bewusst
 * frei von Uhr und Datenbank: `from` ist der Bezugszeitpunkt, und das
 * Ergebnis ist der erste Zeitpunkt, der **nach** diesem liegt.
 */

export type Schedule =
  /** Einmal zu einem genauen Zeitpunkt. */
  | { kind: 'once'; at: number }
  /** Alle N Minuten, jeweils von der letzten Ausführung aus gerechnet. */
  | { kind: 'interval'; minutes: number }
  /** Jeden Tag zu einer Uhrzeit („07:30"). */
  | { kind: 'daily'; time: string }
  /** Jede Woche an einem Wochentag (0 = Sonntag) zu einer Uhrzeit. */
  | { kind: 'weekly'; weekday: number; time: string }

/** Kleinstes sinnvolles Intervall: eine Minute. */
const MINUTE = 60_000

/** Zerlegt „HH:MM" in Minuten seit Mitternacht; notfalls die Vorgabe. */
export function minutesOfDay(time: string | undefined, fallback = 0): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec((time ?? '').trim())
  if (!match) return fallback
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return fallback
  return hours * 60 + minutes
}

/** Der nächste Zeitpunkt an diesem Datum (in Minuten nach Mitternacht). */
function atMinutesOfDay(from: Date, minutes: number): Date {
  const at = new Date(from)
  at.setHours(0, 0, 0, 0)
  at.setMinutes(minutes)
  return at
}

/**
 * Der erste Laufzeitpunkt, der strikt nach `from` liegt.
 * Eine Zahl kleiner als `from` bedeutet bei „einmal": erschöpft, nie wieder.
 */
export function nextRunAt(schedule: Schedule | undefined, from: number): number {
  if (!schedule) return 0
  const now = new Date(from)

  switch (schedule.kind) {
    case 'once':
      return schedule.at > from ? schedule.at : 0

    case 'interval': {
      const minutes = Math.max(1, Math.round(schedule.minutes || 0))
      return from + minutes * MINUTE
    }

    case 'daily': {
      const today = atMinutesOfDay(now, minutesOfDay(schedule.time))
      // Knapp verpasste Läufe heute nicht hinterherwerfen: der nächste zählt.
      return today.getTime() > from ? today.getTime() : today.getTime() + 24 * 60 * MINUTE
    }

    case 'weekly': {
      const weekday = ((Math.round(schedule.weekday) % 7) + 7) % 7
      const wanted = atMinutesOfDay(now, minutesOfDay(schedule.time))
      let delta = (weekday - now.getDay() + 7) % 7
      if (delta === 0 && wanted.getTime() <= from) delta = 7
      wanted.setDate(wanted.getDate() + delta)
      return wanted.getTime()
    }
  }
}

/**
 * Prüft einen Zeitplan und richtet kaputte Werte ein. Liefert die bereinigte
 * Fassung, oder `undefined`, wenn der Plan grundlos ist.
 */
export function normalizeSchedule(schedule: Schedule | undefined): Schedule | undefined {
  if (!schedule) return undefined
  switch (schedule.kind) {
    case 'once':
      return Number.isFinite(schedule.at) && schedule.at > 0 ? schedule : undefined
    case 'interval':
      return Number.isFinite(schedule.minutes) && schedule.minutes >= 1
        ? { kind: 'interval', minutes: Math.round(schedule.minutes) }
        : undefined
    case 'daily':
      return { kind: 'daily', time: formatTime(minutesOfDay(schedule.time)) }
    case 'weekly':
      return { kind: 'weekly', weekday: ((Math.round(schedule.weekday) % 7) + 7) % 7, time: formatTime(minutesOfDay(schedule.time)) }
  }
}

/** Macht Minuten seit Mitternacht zu „HH:MM". */
export function formatTime(minutes: number): string {
  const safe = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)))
  const hours = Math.floor(safe / 60)
  const rest = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}
