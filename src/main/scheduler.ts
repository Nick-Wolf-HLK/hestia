/**
 * Der Ablaufverwalter für geplante Aufträge.
 *
 * Er prüft in kurzen Abständen, ob etwas fällig ist, und löst es aus. Drei
 * Dinge sind dabei wichtiger als Pünktlichkeit:
 *
 * 1. **Kein zweiter Lauf, während einer läuft.** Ein Auftrag, der arbeitet,
 *    wird nicht noch einmal angestoßen — auch nicht, wenn er längst überfällig
 *    ist.
 * 2. **Der nächste Termin steht fest, bevor die Arbeit beginnt.** Sonst könnte
 *    ein langer Lauf dazu führen, dass derselbe Auftrag mehrfach startet.
 * 3. **Ein Nachholen bleibt bei einem Lauf.** War die App ein Woche zu und ein
 *    Fünf-Minuten-Plan ist 2000-mal überfällig, läuft er einmal nach — nicht
 *    2000-mal. Überfällige Aufträge werden beim Anfahren schlicht beim ersten
 *    Prüfen erledigt und dann in die Zukunft gesetzt.
 */
import type { PlannedTask } from '@shared/types'
import { nextRunAt } from '@shared/schedule'
import { log } from './logger'

/** Prüfabstand: ein Minutenraster wäre spürbar ungenau, schneller unnötig. */
const TICK_MS = 15_000

/** Was der Verwalter vom Speicher braucht — mehr nicht. */
export interface PlannedStore {
  listPlanned(): PlannedTask[]
  recordPlannedRun(id: string, run: { at: number; chatId?: string; error?: string; nextRunAt: number }): void
}

export interface SchedulerDeps {
  store: PlannedStore
  /** Startet den Auftrag und meldet den Chat, in dem er gelaufen ist. */
  runTask: (task: PlannedTask) => Promise<{ chatId?: string; error?: string }>
  /** Meldet Änderungen, damit die Ansicht frisch geholt wird. */
  onChanged: () => void
  /**
   * Wirft das Ergebnis nach draußen — in die Meldungszeile des Rechners.
   * Nur das Ergebnis, nie einzelne Schritte: sonst hört niemand nach zwei
   * Tagen noch hin. Wer nichts angibt, bekommt gar keine Meldung.
   */
  melden?: (meldung: { titel: string; text: string; fehler?: boolean; chatId?: string }) => void
  now?: () => number
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null
  /** Die Aufträge, die gerade arbeiten. */
  private running = new Set<string>()
  /** Schutz davor, dass zwei Prüfungen ineinandergreifen. */
  private busy = false

  constructor(private deps: SchedulerDeps) {}

  start(): void {
    if (this.timer) return
    // Erst sofort prüfen (Nachholbetrieb nach dem Start), dann im Raster.
    void this.tick()
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    log.info('Ablaufverwalter startet')
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * Führt einen Auftrag sofort aus, ohne auf seinen Termin zu warten. Der
   * nächste Termin bleibt dabei erhalten, nur von jetzt an gerechnet — wer
   * heute Mittag „morgens um acht" einmal vorzieht, will nicht morgen früh
   * doppelt laufen.
   */
  async runNow(task: PlannedTask): Promise<void> {
    if (this.running.has(task.id)) return
    const now = (this.deps.now ?? Date.now)()
    await this.runOne(task, now, nextRunAt(task.schedule, now))
  }

  /** Ein Prüflauf. Auch von außen aufrufbar, etwa nach dem Anlegen eines Plans. */
  async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    const now = (this.deps.now ?? Date.now)()
    try {
      const due = this.deps.store
        .listPlanned()
        .filter((task) => task.enabled && task.nextRunAt > 0 && task.nextRunAt <= now)

      // Einer nach dem anderen: die Läufe sollen sich nicht gegenseitig im
      // Arbeitsordner stören.
      for (const task of due) await this.runOne(task, now)
    } catch (error) {
      log.error('Ablaufverwalter: Prüfung fehlgeschlagen', (error as Error).message)
    } finally {
      this.busy = false
    }
  }

  private async runOne(task: PlannedTask, now: number, upcomingOverride?: number): Promise<void> {
    if (this.running.has(task.id)) return
    this.running.add(task.id)

    // Der Folgetermin wird VOR der Arbeit berechnet — siehe Kopfzeile.
    const upcoming =
      task.schedule.kind === 'once' ? 0 : (upcomingOverride ?? nextRunAt(task.schedule, now))

    try {
      const result = await this.deps.runTask(task)
      this.deps.store.recordPlannedRun(task.id, {
        at: now,
        chatId: result.chatId,
        error: result.error,
        nextRunAt: upcoming
      })
      if (result.error) {
        log.warn('Geplanter Auftrag fehlgeschlagen', { id: task.id, fehler: result.error })
        this.deps.melden?.({ titel: task.title, text: result.error, fehler: true, chatId: result.chatId })
      } else {
        log.info('Geplanter Auftrag ausgeführt', { id: task.id, titel: task.title, nächster: upcoming || 'kein' })
        this.deps.melden?.({
          titel: task.title,
          text: result.chatId
            ? 'Fertig — das Ergebnis liegt im Gespräch.'
            : 'Fertig — ohne eigenes Gespräch gelaufen.',
          chatId: result.chatId
        })
      }
    } catch (error) {
      this.deps.store.recordPlannedRun(task.id, {
        at: now,
        error: (error as Error).message,
        nextRunAt: upcoming
      })
      log.error('Geplanter Auftrag fehlgeschlagen', `${task.title}: ${(error as Error).message}`)
      this.deps.melden?.({ titel: task.title, text: (error as Error).message, fehler: true })
    } finally {
      this.running.delete(task.id)
      this.deps.onChanged()
    }
  }
}
