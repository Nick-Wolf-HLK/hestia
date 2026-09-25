/**
 * Prüfungen der Zeitrechnung für geplante Aufträge. Die Zeitpunkte sind
 * absichtlich als lokale Datums angegeben, weil die Rechnung lokal denkt.
 */
import { describe, expect, it } from 'vitest'
import { formatTime, minutesOfDay, nextRunAt, normalizeSchedule } from '../../src/shared/schedule'

/** Lokaler Zeitpunkt, damit die Prüfung auf jedem Rechner gleich bleibt. */
const at = (text: string): number => new Date(text).getTime()

describe('Zeitpläne', () => {
  it('gibt einen einmaligen Plan wieder her, wenn er noch vor uns liegt', () => {
    const from = at('2026-03-01T09:00:00')
    const later = at('2026-03-01T18:00:00')

    expect(nextRunAt({ kind: 'once', at: later }, from)).toBe(later)
  })

  it('sagt bei einem verstrichenen einmaligen Plan: nie wieder', () => {
    const from = at('2026-03-01T09:00:00')

    expect(nextRunAt({ kind: 'once', at: at('2026-03-01T08:00:00') }, from)).toBe(0)
  })

  it('rechnet den nächsten Tag, wenn die Zeit heute schon vorbei ist', () => {
    const next = new Date(nextRunAt({ kind: 'daily', time: '07:30' }, at('2026-03-01T09:00:00')))

    expect([next.getMonth(), next.getDate(), next.getHours(), next.getMinutes()]).toEqual([2, 2, 7, 30])
  })

  it('lässt heute noch laufen, wenn die Zeit vor uns liegt', () => {
    const next = nextRunAt({ kind: 'daily', time: '18:00' }, at('2026-03-01T09:00:00'))

    expect(new Date(next).getHours()).toBe(18)
    expect(new Date(next).getDate()).toBe(1)
  })

  it('rutscht über den Monats- und Jahresrand richtig', () => {
    const nextMonth = new Date(nextRunAt({ kind: 'daily', time: '08:00' }, at('2026-01-31T23:00:00')))
    const nextYear = new Date(nextRunAt({ kind: 'daily', time: '08:00' }, at('2026-12-31T23:30:00')))

    // Vom 31. Januar auf den 1. Februar, von Silvester auf Neujahr.
    expect([nextMonth.getFullYear(), nextMonth.getMonth(), nextMonth.getDate()]).toEqual([2026, 1, 1])
    expect([nextYear.getFullYear(), nextYear.getMonth(), nextYear.getDate()]).toEqual([2027, 0, 1])
  })

  it('trifft den gewünschten Wochentag und sonst die nächste Woche', () => {
    // Der 2026-03-04 ist ein Mittwoch (3).
    const from = at('2026-03-04T10:00:00')
    const sameDayLater = nextRunAt({ kind: 'weekly', weekday: 3, time: '18:00' }, from)
    const sameDayPast = nextRunAt({ kind: 'weekly', weekday: 3, time: '08:00' }, from)
    const monday = nextRunAt({ kind: 'weekly', weekday: 1, time: '09:00' }, from)

    expect(new Date(sameDayLater).getHours()).toBe(18)
    // Vorbei heißt: nächste Woche um dieselbe Uhrzeit, also sieben Tage später.
    const past = new Date(sameDayPast)
    expect([past.getDay(), past.getHours(), past.getMinutes()]).toEqual([3, 8, 0])
    expect(sameDayPast - from).toBeGreaterThan(6 * 24 * 3600_000)
    const nextMonday = new Date(monday)
    expect([nextMonday.getDay(), nextMonday.getHours()]).toEqual([1, 9])
    expect(monday).toBeGreaterThan(from)
  })

  it('rechnet Intervalle von jetzt an und nie unter einer Minute', () => {
    const from = at('2026-03-01T09:00:00')

    expect(nextRunAt({ kind: 'interval', minutes: 30 }, from)).toBe(from + 30 * 60_000)
    expect(nextRunAt({ kind: 'interval', minutes: 0 }, from)).toBe(from + 60_000)
  })

  it('kennt ohne Plan keinen nächsten Lauf', () => {
    expect(nextRunAt(undefined, at('2026-03-01T09:00:00'))).toBe(0)
  })

  it('richtet Uhrzeiten und Wochentage ein', () => {
    expect(minutesOfDay('07:05')).toBe(425)
    // Unsinnige Zeiten fallen auf Mitternacht zurück statt zu crashen.
    expect(minutesOfDay('99:99')).toBe(0)
    expect(minutesOfDay(undefined)).toBe(0)
    expect(formatTime(425)).toBe('07:05')
    expect(normalizeSchedule({ kind: 'weekly', weekday: 10, time: '7:5' })?.kind).toBe('weekly')
    expect(normalizeSchedule({ kind: 'interval', minutes: 0 })).toBeUndefined()
    expect(normalizeSchedule({ kind: 'once', at: 0 })).toBeUndefined()
  })

  it('aus einer kaputten Uhrzeit wird eine brauchbare', () => {
    const daily = normalizeSchedule({ kind: 'daily', time: 'Quatsch' })

    expect(daily).toEqual({ kind: 'daily', time: '00:00' })
  })
})
