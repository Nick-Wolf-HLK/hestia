/**
 * Geplant: Aufträge, die von allein laufen.
 *
 * Ein Zeitplan ist hier mehr als ein Wecker: Der Auftrag geht um die eingetragene
 * Zeit durch denselben Lauf, als hättest du ihn selbst getippt — eigener Chat,
 * eigene Werkzeugerlaubnis. Die Ansicht weiß davon nur, was der Hauptprozess
 * meldet, und holt sich die Liste nach jeder Änderung frisch.
 */
import { useEffect, useState } from 'react'
import type { ChatMode, PlannedTask } from '@shared/types'
import type { Schedule } from '@shared/schedule'
import type { Translate } from '../../i18n'
import { appStore, useApp } from '../../lib/store'
import { IconBolt, IconBulb, IconCalendar, IconChecklist, IconClock, IconClose, IconPause, IconPencil, IconPlay, IconPlus, IconSearch, IconSort, IconSun, IconBinoculars, IconTrash, IconTray } from '../../components/Icons'

type Kind = Schedule['kind']

/** Die sechs Vorschläge, mit festem Schlüssel für die Übersetzung. */
type SuggestionKey = 'briefing' | 'inbox' | 'meeting' | 'week' | 'ideas' | 'watch'

/** Formulareingaben: bewusst lose, die Prüfung kommt beim Speichern. */
interface Draft {
  id?: string
  title: string
  prompt: string
  mode: ChatMode
  folder?: string
  /** Von der Projektseite angelegt: läuft im Projekt. */
  projectId?: string
  kind: Kind
  /** „2026-03-01T07:30" aus dem Datums-Zeit-Feld. */
  when: string
  time: string
  weekday: number
  minutes: number
  enabled: boolean
}

const toLocalInput = (ms: number): string => {
  const date = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const emptyDraft = (): Draft => {
  const soon = new Date(Date.now() + 5 * 60_000)
  return {
    title: '',
    prompt: '',
    mode: 'chat',
    kind: 'daily',
    when: toLocalInput(soon.getTime()),
    time: '08:00',
    weekday: 1,
    minutes: 60,
    enabled: true
  }
}

const draftToSchedule = (draft: Draft): Schedule => {
  switch (draft.kind) {
    case 'once':
      return { kind: 'once', at: new Date(draft.when).getTime() }
    case 'interval':
      return { kind: 'interval', minutes: Math.max(1, Math.round(draft.minutes)) }
    case 'weekly':
      return { kind: 'weekly', weekday: draft.weekday, time: draft.time }
    default:
      return { kind: 'daily', time: draft.time }
  }
}

const draftFromTask = (task: PlannedTask): Draft => {
  const base = emptyDraft()
  const schedule = task.schedule
  return {
    ...base,
    id: task.id,
    title: task.title,
    prompt: task.prompt,
    mode: task.mode,
    folder: task.folder,
    enabled: task.enabled,
    kind: schedule.kind,
    when: schedule.kind === 'once' ? toLocalInput(schedule.at) : base.when,
    time: 'time' in schedule ? schedule.time : base.time,
    weekday: schedule.kind === 'weekly' ? schedule.weekday : base.weekday,
    minutes: schedule.kind === 'interval' ? schedule.minutes : base.minutes
  }
}

/** Platzhalter für die Wochentage, damit die Schlüssel prüfbar bleiben. */
const WEEKDAY_KEYS = [
  'planned.weekday.0',
  'planned.weekday.1',
  'planned.weekday.2',
  'planned.weekday.3',
  'planned.weekday.4',
  'planned.weekday.5',
  'planned.weekday.6'
] as const

const WEEKDAY_SHORT_KEYS = [
  'planned.weekdayShort.0',
  'planned.weekdayShort.1',
  'planned.weekdayShort.2',
  'planned.weekdayShort.3',
  'planned.weekdayShort.4',
  'planned.weekdayShort.5',
  'planned.weekdayShort.6'
] as const

/** Menschenlesbar machen, was gespeichert ist. */
export function describe(task: PlannedTask, t: Translate): string {
  const schedule = task.schedule
  switch (schedule.kind) {
    case 'once':
      return new Date(schedule.at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
    case 'interval':
      return t('planned.everyN').replace('{count}', String(schedule.minutes))
    case 'daily':
      return `${t('planned.everyday')} ${schedule.time}`
    case 'weekly': {
      const key = WEEKDAY_SHORT_KEYS[schedule.weekday] ?? WEEKDAY_SHORT_KEYS[1]
      return `${t(key)} ${schedule.time}`
    }
  }
}

export function PlannedView({ t }: { t: Translate }) {
  const [tasks, setTasks] = useState<PlannedTask[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const projekte = useApp((s) => s.projects)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  // Eine Fehlermeldung gehört zum Formular, in dem sie entstand: öffnen oder
  // schließen setzt sie zurück.
  const offen = draft !== null
  useEffect(() => setError(undefined), [offen])

  // Wie in den anderen Fenstern: die Flucht-Taste schließt das Formular —
  // unabhängig davon, welches Feld gerade den Fokus hat.
  useEffect(() => {
    if (!draft) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setDraft(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft])

  const load = async (): Promise<void> => setTasks(await window.desk.planned.list())

  // Von der Projektseite kommend: das Formular gleich mit Projektbezug öffnen.
  useEffect(() => {
    const vorlage = appStore.nimmPlannedVorlage()
    if (vorlage) setDraft({ ...emptyDraft(), ...vorlage })
  }, [])

  useEffect(() => {
    void load()
    return window.desk.planned.onChanged(() => void load())
  }, [])

  const save = async (): Promise<void> => {
    if (!draft) return
    setError(undefined)
    if (!draft.prompt.trim()) {
      setError(t('planned.needsPrompt'))
      return
    }
    if (draft.mode === 'agent' && !draft.folder) {
      setError(t('planned.needsFolder'))
      return
    }
    setBusy(true)
    try {
      const schedule = draftToSchedule(draft)
      if (draft.id) {
        await window.desk.planned.update({
          id: draft.id,
          patch: {
            title: draft.title,
            prompt: draft.prompt,
            mode: draft.mode,
            folder: draft.folder,
            schedule,
            enabled: draft.enabled
          }
        })
      } else {
        await window.desk.planned.create({
          title: draft.title,
          prompt: draft.prompt,
          mode: draft.mode,
          folder: draft.folder,
          projectId: draft.projectId,
          schedule,
          enabled: draft.enabled
        })
      }
      setDraft(null)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const patchDraft = (patch: Partial<Draft>): void => setDraft((current) => (current ? { ...current, ...patch } : current))

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'next' | 'title'>('next')
  const [noteClosed, setNoteClosed] = useState(false)

  /**
   * Vorschläge sind keine Deko: Ein Klick füllt dasselbe Formular, das du
   * selbst ausfüllen würdest — Titel, Auftrag und Rhythmus. Ändern lässt sich
   * danach alles, und nichts läuft, bevor du speicherst.
   */
  const suggestions: { key: SuggestionKey; icon: typeof IconSun; patch: Partial<Draft> }[] = [
    { key: 'briefing', icon: IconSun, patch: { kind: 'daily', time: '08:00' } },
    { key: 'inbox', icon: IconTray, patch: { kind: 'daily', time: '08:00' } },
    { key: 'meeting', icon: IconCalendar, patch: { kind: 'daily', time: '08:00' } },
    { key: 'week', icon: IconChecklist, patch: { kind: 'weekly', weekday: 5, time: '16:00' } },
    { key: 'ideas', icon: IconBulb, patch: { kind: 'weekly', weekday: 1, time: '09:00' } },
    { key: 'watch', icon: IconBinoculars, patch: { kind: 'daily', time: '09:00' } }
  ]

  const fromSuggestion = (key: SuggestionKey): void => {
    const found = suggestions.find((item) => item.key === key)
    if (!found) return
    setDraft({ ...emptyDraft(), title: t(`planned.template.${key}`), prompt: t(`planned.template.${key}.text`), ...found.patch })
  }

  const q = query.trim().toLowerCase()
  const ordered = tasks
    .filter((task) => !q || task.title.toLowerCase().includes(q) || task.prompt.toLowerCase().includes(q))
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title, 'de')
        : (a.nextRunAt ?? Number.MAX_SAFE_INTEGER) - (b.nextRunAt ?? Number.MAX_SAFE_INTEGER)
    )

  const pickFolder = async (): Promise<void> => {
    const picked = await window.desk.dialogs.pickFolder()
    if (picked) patchDraft({ folder: picked })
  }

  return (
    <div className="main__scroll">
      <div className="pane pane--wide">
        <div className="pane__head">
          <div className="pane__heading">
            <h2 className="pane__title">{t('nav.scheduled')}</h2>
            <p className="pane__subtitle">{t('planned.subtitle')}</p>
          </div>
          <div className="pane__tools">
            <div className="pane__search">
              <IconSearch size={14} />
              <input placeholder={t('pane.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('pane.search')} />
            </div>
            <label className="pane__sort">
              <span>{t('pane.sort')}</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as 'next' | 'title')} aria-label={t('pane.sort')}>
                <option value="next">{t('pane.sort.next')}</option>
                <option value="title">{t('pane.sort.name')}</option>
              </select>
              <IconSort size={13} />
            </label>
            <button type="button" className="btn" data-variant="primary" onClick={() => setDraft(emptyDraft())}>
              <IconPlus size={13} /> {t('planned.new')}
            </button>
          </div>
        </div>

        {!noteClosed && (
          <div className="note">
            <span className="note__badge">{t('nav.new')}</span>
            <p className="note__text">{t('planned.localNote')}</p>
            <button type="button" className="note__close" onClick={() => setNoteClosed(true)} aria-label={t('toolbar.close')}>
              <IconClose size={14} />
            </button>
          </div>
        )}

        {ordered.length === 0 && !draft && (
          <div className="planned-empty">
            <span className="planned-empty__mark" aria-hidden="true">
              <svg viewBox="0 0 96 96" width="88" height="88">
                <circle cx="48" cy="56" r="28" />
                <path d="M40 12h16M48 12v10M48 56V42M48 56l11 7M74 24l8-8" />
                <path d="M30 20 22 12" />
              </svg>
            </span>
            <p className="planned-empty__text">{t('planned.emptyTitle')}</p>
          </div>
        )}

        {suggestions.length > 0 && (
          <>
            <hr className="pane__wave" />
            <p className="pane__lead">{t('planned.suggestions')}</p>
            <div className="suggestions">
              {suggestions.map(({ key, icon: Mark }) => (
                <button type="button" className="suggestion" key={key} onClick={() => fromSuggestion(key)}>
                  <span className="suggestion__mark">
                    <Mark size={18} />
                  </span>
                  <span className="suggestion__body">
                    <span className="suggestion__title">{t(`planned.template.${key}`)}</span>
                    <span className="suggestion__text">{t(`planned.template.${key}.text`)}</span>
                    <span className="suggestion__when">
                      <IconClock size={12} /> {t(`planned.template.${key}.when`)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="planned-list">
          {ordered.map((task) => (
            <div className="planned-item" key={task.id} data-paused={!task.enabled}>
              <div className="planned-item__main">
                <div className="planned-item__title">{task.title}</div>
                <div className="planned-item__prompt">{task.prompt}</div>
                <div className="planned-item__meta">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <IconClock size={12} /> {describe(task, t)}
                  </span>
                  <span>
                    {task.enabled
                      ? `${t('planned.next')}: ${task.nextRunAt ? new Date(task.nextRunAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : t('planned.noneLeft')}`
                      : t('planned.paused')}
                  </span>
                  {task.mode === 'agent' && <span>{t('home.mode.agent')}</span>}
                  {task.lastRunAt !== undefined && (
                    <span>
                      {t('planned.last')}: {new Date(task.lastRunAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  )}
                </div>
                {task.lastError && <div className="planned-item__error">{task.lastError}</div>}
              </div>

              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button
                  type="button"
                  className="icon-btn"
                  title={task.enabled ? t('planned.pause') : t('planned.resume')}
                  aria-label={task.enabled ? t('planned.pause') : t('planned.resume')}
                  onClick={() => void window.desk.planned.update({ id: task.id, patch: { enabled: !task.enabled } }).then(load)}
                >
                  {task.enabled ? <IconPause size={14} /> : <IconPlay size={14} />}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title={t('planned.runNow')}
                  aria-label={t('planned.runNow')}
                  onClick={() => {
                    void window.desk.planned.runNow(task.id)
                    setTimeout(() => void load(), 1200)
                  }}
                >
                  <IconBolt size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title={t('planned.edit')}
                  aria-label={t('planned.edit')}
                  onClick={() => setDraft(draftFromTask(task))}
                >
                  <IconPencil size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title={t('planned.delete')}
                  aria-label={t('planned.delete')}
                  onClick={() => void window.desk.planned.remove(task.id).then(load)}
                >
                  <IconTrash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '18px 0 40px', maxWidth: 520 }}>{t('planned.needsApp')}</p>
      </div>

      {draft && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setDraft(null)}>
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal__head">
              <div className="modal__title">{draft.id ? t('planned.edit') : t('planned.new')}</div>
            </div>
            <div className="planned-form" style={{ padding: '0 18px 18px' }}>
              {draft.projectId && (
                <p className="hinweis">{t('planned.inProject', { name: projekte.find((p) => p.id === draft.projectId)?.name ?? '' })}</p>
              )}
              <div className="field">
                <label htmlFor="planned-title">{t('planned.title')}</label>
                <input
                  id="planned-title"
                  className="input"
                  value={draft.title}
                  placeholder={t('planned.titleHint')}
                  onChange={(e) => patchDraft({ title: e.target.value })}
                />
              </div>

              <div className="field">
                <label htmlFor="planned-prompt">{t('planned.prompt')}</label>
                <textarea
                  id="planned-prompt"
                  className="input"
                  rows={4}
                  value={draft.prompt}
                  placeholder={t('planned.promptHint')}
                  onChange={(e) => patchDraft({ prompt: e.target.value })}
                />
              </div>

              <div className="formzeile">
                <div className="field" style={{ flex: 1 }}>
                  <label>{t('planned.mode')}</label>
                  <div className="segmented" role="radiogroup">
                    {(['chat', 'agent'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={draft.mode === value}
                        data-active={draft.mode === value}
                        onClick={() => patchDraft({ mode: value })}
                      >
                        {t(`home.mode.${value}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>{t('planned.when')}</label>
                  <div className="segmented" role="radiogroup">
                    {(['once', 'daily', 'weekly', 'interval'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={draft.kind === value}
                        data-active={draft.kind === value}
                        onClick={() => patchDraft({ kind: value })}
                      >
                        {t(`planned.kind.${value}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {draft.kind === 'once' && (
                <div className="field">
                  <label htmlFor="planned-when">{t('planned.at')}</label>
                  <input
                    id="planned-when"
                    className="input"
                    type="datetime-local"
                    value={draft.when}
                    onChange={(e) => patchDraft({ when: e.target.value })}
                  />
                </div>
              )}

              {(draft.kind === 'daily' || draft.kind === 'weekly') && (
                <div className="field">
                  <label htmlFor="planned-time">{t('planned.time')}</label>
                  <input id="planned-time" className="input" type="time" value={draft.time} onChange={(e) => patchDraft({ time: e.target.value })} />
                </div>
              )}

              {draft.kind === 'weekly' && (
                <div className="field">
                  <label htmlFor="planned-weekday">{t('planned.weekday')}</label>
                  <select
                    id="planned-weekday"
                    className="input"
                    value={draft.weekday}
                    onChange={(e) => patchDraft({ weekday: Number(e.target.value) })}
                  >
                    {WEEKDAY_KEYS.map((key, day) => (
                      <option key={key} value={day}>
                        {t(key)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {draft.kind === 'interval' && (
                <div className="field">
                  <label htmlFor="planned-minutes">{t('planned.minutes')}</label>
                  <input
                    id="planned-minutes"
                    className="input"
                    type="number"
                    min={1}
                    value={draft.minutes}
                    onChange={(e) => patchDraft({ minutes: Number(e.target.value) })}
                  />
                </div>
              )}

              {draft.mode === 'agent' && (
                <div className="field">
                  <label>{t('planned.folder')}</label>
                  <button type="button" className="btn" data-variant="ghost" onClick={() => void pickFolder()}>
                    {draft.folder ?? t('planned.pickFolder')}
                  </button>
                </div>
              )}

              {error && <div className="notice">{error}</div>}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" className="btn" data-variant="ghost" onClick={() => setDraft(null)}>
                  {t('planned.cancel')}
                </button>
                <button type="button" className="btn" data-variant="primary" disabled={busy} onClick={() => void save()}>
                  {t('planned.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
