/**
 * Kommt draußen an, was drinnen fertig wird?
 *
 * Ein geplanter Auftrag läuft oft, während jemand anderes arbeitet. Was er
 * hinterläßt, muß daher **sichtbar** enden: eine Meldung für das Ergebnis, eine
 * lautere für den Fehler. Und wer keine Meldungen will, darf deshalb nicht
 * scheitern.
 */
import { describe, expect, it, vi } from 'vitest'
import { Scheduler } from '../../src/main/scheduler'
import type { PlannedTask } from '../../src/shared/types'

function auftrag(anteile: Partial<PlannedTask> = {}): PlannedTask {
  return {
    id: 'a1',
    title: 'Tagesüberblick',
    prompt: 'Fasse zusammen',
    schedule: { kind: 'once', at: 1000 },
    enabled: true,
    nextRunAt: 1000,
    folder: '',
    mode: 'chat',
    runs: [],
    createdAt: 0,
    ...anteile
  } as PlannedTask
}

function ablage() {
  const naechstes: Array<Record<string, unknown>> = []
  return {
    eintrag: () => {},
    liste: () => [auftrag()],
    store: { listPlanned: () => [auftrag()], recordPlannedRun: (_id: string, lauf: Record<string, unknown>) => naechstes.push(lauf) }
  }
}

describe('die Meldung eines geplanten Laufes', () => {
  it('meldet das Ergebnis nach draußen', async () => {
    const gemeldet: Array<{ titel: string; text: string; fehler?: boolean }> = []
    const { store } = ablage()
    const verwalter = new Scheduler({
      store,
      runTask: async () => ({ chatId: 'c1' }),
      onChanged: () => {},
      melden: (meldung) => gemeldet.push(meldung),
      now: () => 2000
    })
    await verwalter.tick()
    expect(gemeldet).toHaveLength(1)
    expect(gemeldet[0]?.titel).toBe('Tagesüberblick')
    expect(gemeldet[0]?.fehler).toBeFalsy()
    expect(gemeldet[0]?.text).toContain('Gespräch')
  })

  it('meldet einen Fehler als Fehler', async () => {
    const gemeldet: Array<{ titel: string; text: string; fehler?: boolean }> = []
    const { store } = ablage()
    const verwalter = new Scheduler({
      store,
      runTask: async () => ({ error: 'Kein Modell erreichbar' }),
      onChanged: () => {},
      melden: (meldung) => gemeldet.push(meldung),
      now: () => 2000
    })
    await verwalter.tick()
    expect(gemeldet[0]?.fehler).toBe(true)
    expect(gemeldet[0]?.text).toContain('Kein Modell erreichbar')
  })

  it('meldet auch, wenn der Lauf selbst wirft', async () => {
    const gemeldet: Array<{ fehler?: boolean; text: string }> = []
    const { store } = ablage()
    const verwalter = new Scheduler({
      store,
      runTask: async () => {
        throw new Error('Ordner fehlt')
      },
      onChanged: () => {},
      melden: (meldung) => gemeldet.push(meldung),
      now: () => 2000
    })
    await verwalter.tick()
    expect(gemeldet).toHaveLength(1)
    expect(gemeldet[0]?.fehler).toBe(true)
    expect(gemeldet[0]?.text).toContain('Ordner fehlt')
  })

  it('läuft ohne Meldungsleitung trotzdem durch', async () => {
    const { store } = ablage()
    const aufgezeichnet = vi.fn()
    store.recordPlannedRun = aufgezeichnet
    const verwalter = new Scheduler({ store, runTask: async () => ({ chatId: 'c1' }), onChanged: () => {}, now: () => 2000 })
    await expect(verwalter.tick()).resolves.toBeUndefined()
    expect(aufgezeichnet).toHaveBeenCalledTimes(1)
  })
})
