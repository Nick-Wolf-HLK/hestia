import { useEffect, useState } from 'react'
import type { Project } from '@shared/types'
import type { Translate } from '../../i18n'
import { appStore, useApp } from '../../lib/store'
import { IconFolder, IconPin, IconPlus, IconSearch, IconSort, IconTrash } from '../../components/Icons'
import { relativeTime } from '../../lib/format'

export function ProjectsView({ t }: { t: Translate }) {
  const projects = useApp((s) => s.projects)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'updated' | 'name'>('updated')
  const [draft, setDraft] = useState<{ name: string; folder?: string; instructions: string } | null>(null)

  const q = query.trim().toLowerCase()
  const visible = projects
    .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.instructions ?? '').toLowerCase().includes(q))
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'de') : b.updatedAt - a.updatedAt))

  return (
    <div className="main__scroll">
      <div className="pane pane--wide">
        <div className="pane__head">
          <div className="pane__heading">
            <h2 className="pane__title">{t('projects.title')}</h2>
          </div>
          <div className="pane__tools">
            <div className="pane__search">
              <IconSearch size={14} />
              <input placeholder={t('pane.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('pane.search')} />
            </div>
            <button
              type="button"
              className="icon-btn"
              title={`${t('pane.sort')}: ${sort === 'updated' ? t('pane.sort.updated') : t('pane.sort.name')}`}
              aria-label={t('pane.sort')}
              onClick={() => setSort(sort === 'updated' ? 'name' : 'updated')}
            >
              <IconSort size={16} />
            </button>
            <button type="button" className="btn" data-variant="primary" onClick={() => setDraft({ name: '', instructions: '' })}>
              <IconPlus size={14} /> {t('projects.new')}
            </button>
          </div>
        </div>

        {visible.length === 0 && <div style={{ color: 'var(--text-muted)' }}>{t('projects.empty')}</div>}

        <div className="project-grid">
          {visible.map((project) => (
            <ProjectCard key={project.id} project={project} t={t} />
          ))}
        </div>

        {draft && (
          <NewProjectDialog
            t={t}
            draft={draft}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onCreate={async () => {
              if (!draft.name.trim()) return
              const projekt = await appStore.createProject({ name: draft.name.trim(), folder: draft.folder, instructions: draft.instructions })
              setDraft(null)
              // Gleich auf die Seite des neuen Projekts — dort kommen die Dateien hinein.
              appStore.openProject(projekt.id)
            }}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Eine Projektkarte. Der Name ist kein Knopf: angeklickt wird die ganze Karte,
 * sie öffnet das Projekt. Nadel und Mülleimer liegen darüber, damit sie nicht
 * den Text verdecken, wenn man sie braucht.
 */
function ProjectCard({ project, t }: { project: Project; t: Translate }) {
  const chats = useApp((s) => s.chats)
  const count = chats.filter((c) => c.projectId === project.id).length
  return (
    <article
      className="project-card"
      // Die Projektseite: Anweisungen, Erinnerungen, Kontext, Ordner, Geplant —
      // und von dort beginnen die Chats, die zum Projekt gehören.
      onClick={() => appStore.openProject(project.id)}
    >
      <header className="project-card__head">
        <h3 className="project-card__name">{project.name}</h3>
        <button
          type="button"
          className="project-card__pin"
          data-on={project.pinned}
          title={project.pinned ? t('projects.unpin') : t('projects.pin')}
          aria-pressed={project.pinned}
          onClick={(event) => {
            event.stopPropagation()
            void appStore.updateProject(project.id, { pinned: !project.pinned })
          }}
        >
          <IconPin size={14} />
        </button>
      </header>
      <p className="project-card__text">{project.instructions ?? ''}</p>
      <footer className="project-card__foot">
        <span>{relativeTime(project.updatedAt, t)}</span>
        {count > 0 && <span>· {count}</span>}
        <button
          type="button"
          className="project-card__remove"
          title={t('settings.remove')}
          onClick={(event) => {
            event.stopPropagation()
            if (confirm(`${t('settings.remove')}: ${project.name}?`)) void appStore.removeProject(project.id)
          }}
        >
          <IconTrash size={14} />
        </button>
      </footer>
    </article>
  )
}

function NewProjectDialog({
  t,
  draft,
  onChange,
  onCancel,
  onCreate
}: {
  t: Translate
  draft: { name: string; folder?: string; instructions: string }
  onChange: (value: { name: string; folder?: string; instructions: string }) => void
  onCancel: () => void
  onCreate: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ width: 'min(520px, 100%)' }}>
        <div className="modal__head">
          <div className="modal__title">{t('projects.new')}</div>
        </div>
        <div className="field">
          <label>{t('projects.name')}</label>
          <input className="input" autoFocus value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
        </div>
        <div className="field">
          <label>{t('projects.folder')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" style={{ flex: 1 }} readOnly value={draft.folder ?? ''} placeholder="—" />
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const picked = await window.desk.dialogs.pickFolder(draft.folder)
                if (picked) onChange({ ...draft, folder: picked })
              }}
            >
              <IconFolder size={14} />
            </button>
          </div>
        </div>
        <div className="field">
          <label>{t('projects.instructions')}</label>
          <textarea
            className="input"
            rows={4}
            value={draft.instructions}
            onChange={(e) => onChange({ ...draft, instructions: e.target.value })}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" data-variant="ghost" onClick={onCancel}>
            {t('action.cancel')}
          </button>
          <button type="button" className="btn" data-variant="primary" onClick={onCreate}>
            {t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
