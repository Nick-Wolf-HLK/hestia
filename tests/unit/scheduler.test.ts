/**
 * Prüfungen des Ablaufverwalters. Hier zählt weniger die Uhr als das
 * Verhalten: Was passiert, wenn etwas überfällig ist, wenn etwas lange läuft
 * und wenn etwas fehlschlägt?
 */
import { describe, expect, it, vi } from 'vitest'
import type { PlannedTask } from '@shared/types'
import { Scheduler } from '../../src/main/scheduler'

/** Zeitanker, damit die Prüfungen nie von der echten Uhr abhängen. */
const NOW = new Date('2026-03-04T09:00:00').getTime()
const MINUTE = 60_000

function makeTask(patch: Partial<PlannedTask> = {}): PlannedTask {
  return {
    id: 'plan-1',
    title: 'Morgenübersicht',
    prompt: 'Fasse zusammen, was ansteht.',
    mode: 'chat',
    schedule: { kind: 'daily', time: '08:00' },
    enabled: true,
    nextRunAt: NOW - MINUTE,
    createdAt: 0,
    updatedAt: 0,
    ...patch
  }
}

/** Kleiner Speicherplatz: zeichnet auf, was der Verwalter notiert. */
function makeStore(tasks: PlannedTask[]) {
  const records: { id: string; at: number; chatId?: string; error?: string; nextRunAt: number }[] = []
  return {
    records,
    store: {
      listPlanned: () => tasks,
      // Wie die echte Datenbank: der notierte Folgetermin gilt ab jetzt,
      // sonst würde derselbe Auftrag bei jedem Prüfen wieder fällig sein.
      recordPlannedRun: (id: string, run: (typeof records)[number]): void => {
        records.push({ ...run, id })
        const index = tasks.findIndex((task) => task.id === id)
        if (index >= 0) tasks[index] = { ...tasks[index]!, nextRunAt: run.nextRunAt, lastRunAt: run.at, lastError: run.error }
      },
      getPlanned: (id: string) => tasks.find((task) => task.id === id)
    }
  }
}

describe('Ablaufverwalter', () => {
  it('lässt einen fälligen Auftrag laufen und setzt den Folgetermin', async () => {
    const task = makeTask()
    const { store, records } = makeStore([task])
    const runTask = vi.fn(async () => ({ chatId: 'chat-9' }))
    const scheduler = new Scheduler({ store, runTask, onChanged: () => {}, now: () => NOW })

    await scheduler.tick()

    expect(runTask).toHaveBeenCalledTimes(1)
    expect(records[0]).toMatchObject({ id: 'plan-1', chatId: 'chat-9' })
    // Täglich um 08:00, es ist 09:00 überfällig → der nächste 08:00 liegt morgen.
    expect(records[0]!.nextRunAt).toBe(new Date('2026-03-05T08:00:00').getTime())
  })

  it('rührt einen Auftrag nicht an, der noch nicht fällig ist', async () => {
    const task = makeTask({ nextRunAt: NOW + 10 * MINUTE })
    const { store, records } = makeStore([task])
    const runTask = vi.fn(async () => ({}))

    await new Scheduler({ store, runTask, onChanged: () => {}, now: () => NOW }).tick()

    expect(runTask).not.toHaveBeenCalled()
    expect(records).toHaveLength(0)
  })

  it('rührt einen pausierten Auftrag nicht an', async () => {
    const task = makeTask({ enabled: false })
    const { store } = makeStore([task])
    const runTask = vi.fn(async () => ({}))

    await new Scheduler({ store, runTask, onChanged: () => {}, now: () => NOW }).tick()

    expect(runTask).not.toHaveBeenCalled()
  })

  it('holt ein Jahr Verpassen nicht Jahr für Jahr nach, sondern einmal', async () => {
    // Uralt überfällig: ein Lauf, dann steht die Zukunft da.
    const task = makeTask({ nextRunAt: NOW - 365 * 24 * 60 * MINUTE })
    const { store, records } = makeStore([task])
    const runTask = vi.fn(async () => ({}))
    const scheduler = new Scheduler({ store, runTask, onChanged: () => {}, now: () => NOW })

    await scheduler.tick()
    await scheduler.tick()
    await scheduler.tick()

    expect(runTask).toHaveBeenCalledTimes(1)
    expect(records[0]!.nextRunAt).toBeGreaterThan(NOW)
  })

  it('lässt denselben Auftrag nicht zweimal gleichzeitig laufen', async () => {
    const task = makeTask()
    const { store } = makeStore([task])
    let release = (): void => {}
    const runTask = vi.fn(
      () =>
        new Promise<{ chatId?: string }>((resolve) => {
          release = () => resolve({ chatId: 'spät' })
        })
    )
    const scheduler = new Scheduler({ store, runTask, onChanged: () => {}, now: () => NOW })

    const first = scheduler.tick()
    await Promise.resolve()
    const second = scheduler.tick()
    const third = await scheduler.runNow(task)

    expect(runTask).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([first, second, third])
  })

  it('macht aus einem einmaligen Plan nach dem Lauf keinen weiteren', async () => {
    const task = makeTask({ schedule: { kind: 'once', at: NOW - MINUTE } })
    const { store, records } = makeStore([task])
    const scheduler = new Scheduler({ store, runTask: async () => ({}), onChanged: () => {}, now: () => NOW })

    await scheduler.tick()

    expect(records[0]!.nextRunAt).toBe(0)
  })

  it('merkt einen Fehlschlag, wirft aber nicht alles um', async () => {
    const broken = makeTask({ id: 'kaputt', nextRunAt: NOW - MINUTE })
    const healthy = makeTask({ id: 'ganz', nextRunAt: NOW - MINUTE })
    const { store, records } = makeStore([broken, healthy])
    const scheduler = new Scheduler({
      store,
      runTask: async (task) => (task.id === 'kaputt' ? { error: 'Kein Anbieter erreichbar' } : { chatId: 'ok' }),
      onChanged: () => {},
      now: () => NOW
    })

    await scheduler.tick()

    expect(records.find((r) => r.id === 'kaputt')?.error).toBe('Kein Anbieter erreichbar')
    expect(records.find((r) => r.id === 'ganz')?.error).toBeUndefined()
  })

  it('sagt der Ansicht Bescheid, damit sie frisch wird', async () => {
    const { store } = makeStore([makeTask()])
    const changed = vi.fn()
    await new Scheduler({ store, runTask: async () => ({}), onChanged: changed, now: () => NOW }).tick()

    expect(changed).toHaveBeenCalled()
  })
})
