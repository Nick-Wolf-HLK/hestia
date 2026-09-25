import { useEffect, useMemo, useState } from 'react'
import type { Artifact, ArtifactKind } from '@shared/types'
import type { Translate } from '../../i18n'
import { appStore, useApp } from '../../lib/store'
import { Markdown } from '../../components/Markdown'
import { IconChecklist, IconClose, IconCode, IconDots, IconFile, IconGrid, IconPin, IconPlus, IconSearch, IconTrash } from '../../components/Icons'
import { relativeTime } from '../../lib/format'

type Filter = 'all' | 'pinned' | 'mine'

const KIND_LABEL: Record<ArtifactKind, string> = {
  markdown: 'Markdown',
  html: 'HTML',
  svg: 'SVG',
  code: 'Code',
  text: 'Text'
}

export function ArtifactsView({ t }: { t: Translate }) {
  const artifacts = useApp((s) => s.artifacts)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | undefined>()
  const [creating, setCreating] = useState(false)
  const [layout, setLayout] = useState<'list' | 'grid'>('list')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return artifacts.filter((a) => {
      if (filter === 'pinned' && !a.pinned) return false
      if (filter === 'mine' && a.kind === 'text' && !a.body) return false
      if (!q) return true
      return a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q)
    })
  }, [artifacts, filter, query])

  /** Gruppenkopf nach Tag: Heute, Gestern, sonst das Datum. */
  const dayLabel = (ms: number): string => {
    const day = new Date(ms)
    const today = new Date()
    const yesterday = new Date(Date.now() - 86_400_000)
    const same = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString()
    if (same(day, today)) return t('time.today')
    if (same(day, yesterday)) return t('time.yesterday')
    return day.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
  }

  const byDay = visible.reduce<Record<string, Artifact[]>>((groups, artifact) => {
    const key = dayLabel(artifact.updatedAt)
    ;(groups[key] ??= []).push(artifact)
    return groups
  }, {})

  const open = artifacts.find((a) => a.id === openId)

  return (
    <div className="main__scroll">
      <div className="pane">
        <div className="artifacts__kopf">
          <h2 style={{ margin: 0, fontSize: 19, flex: 1 }}>{t('nav.artifacts')}</h2>
          <div className="segmented">
            {(['all', 'pinned', 'mine'] as const).map((value) => (
              <button key={value} type="button" data-active={filter === value} onClick={() => setFilter(value)}>
                {value === 'all' ? t('artifacts.all') : value === 'pinned' ? t('artifacts.pinned') : t('artifacts.mine')}
              </button>
            ))}
          </div>
          <div className="artifacts__suche">
            <IconSearch size={14} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--text-faint)' }} />
            <input
              className="input"
              style={{ paddingLeft: 28 }}
              placeholder={t('artifacts.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={layout === 'list' ? 'Raster' : 'Liste'}
            title={layout === 'list' ? 'Raster' : 'Liste'}
            onClick={() => setLayout(layout === 'list' ? 'grid' : 'list')}
          >
            {layout === 'list' ? <IconGrid size={16} /> : <IconChecklist size={16} />}
          </button>
          <button type="button" className="btn" data-variant="primary" onClick={() => setCreating(true)}>
            <IconPlus size={14} /> {t('artifacts.new')}
          </button>
        </div>

        {visible.length === 0 && (
          <div style={{ color: 'var(--text-muted)', padding: '18px 0' }}>{t('artifacts.empty')}</div>
        )}

        {layout === 'grid' ? (
          <div className="artifact-grid">
            {visible.map((artifact) => (
              <button key={artifact.id} type="button" className="artifact-tile" onClick={() => setOpenId(artifact.id)}>
                <span className="artifact-tile__marks">
                  <span className="badge">{KIND_LABEL[artifact.kind]}</span>
                  {artifact.pinned && <IconPin size={12} />}
                </span>
                <span className="artifact-tile__title">{artifact.title}</span>
                <span className="artifact-tile__time">{relativeTime(artifact.updatedAt, t)}</span>
              </button>
            ))}
          </div>
        ) : (
          /* Nach Tagen gruppiert: der eigene Arbeitstag ist die natürlichste Ordnung. */
          Object.entries(byDay).map(([day, items]) => (
            <section className="artifact-group" key={day}>
              <h3 className="artifact-group__day">{day}</h3>
              {items.map((artifact) => (
                <div className="artifact-row" key={artifact.id}>
                  <button type="button" className="artifact-row__open" onClick={() => setOpenId(artifact.id)}>
                    <span className="artifact-row__mark">
                      {artifact.kind === 'code' || artifact.kind === 'html' ? <IconCode size={16} /> : <IconFile size={16} />}
                    </span>
                    <span className="artifact-row__title">{artifact.title}</span>
                    <span className="artifact-row__seen">
                      {t('artifacts.seen')} {relativeTime(artifact.updatedAt, t)}
                    </span>
                  </button>
                  {artifact.pinned && <IconPin size={13} style={{ color: 'var(--accent)' }} />}
                  <button
                    type="button"
                    className="artifact-row__more"
                    aria-label={artifact.pinned ? t('projects.unpin') : t('projects.pin')}
                    onClick={() => void appStore.updateArtifact(artifact.id, { pinned: !artifact.pinned })}
                  >
                    <IconDots size={16} />
                  </button>
                </div>
              ))}
            </section>
          ))
        )}

        {open && <ArtifactDetail artifact={open} t={t} onClose={() => setOpenId(undefined)} />}
        {creating && <NewArtifact t={t} onClose={() => setCreating(false)} />}
      </div>
    </div>
  )
}

function ArtifactDetail({ artifact, t, onClose }: { artifact: Artifact; t: Translate; onClose: () => void }) {
  const [body, setBody] = useState(artifact.body)
  const [preview, setPreview] = useState(artifact.kind !== 'text')
  const dirty = body !== artifact.body

  useEffect(() => {
    setBody(artifact.body)
  }, [artifact.id, artifact.body])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(880px, 100%)' }}>
        <div className="modal__head">
          <input
            className="input"
            style={{ flex: 1, fontWeight: 600 }}
            value={artifact.title}
            onChange={(e) => void appStore.updateArtifact(artifact.id, { title: e.target.value })}
          />
          <button type="button" className="icon-btn" onClick={() => void appStore.updateArtifact(artifact.id, { pinned: !artifact.pinned })} title={t('artifacts.pinned')}>
            <IconPin size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('settings.close')}>
            <IconClose />
          </button>
        </div>

        <div className="werkzeugzeile">
          <div className="segmented">
            <button type="button" data-active={preview} onClick={() => setPreview(true)}>
              {t('artifacts.view')}
            </button>
            <button type="button" data-active={!preview} onClick={() => setPreview(false)}>
              {t('artifacts.source')}
            </button>
          </div>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={() => void appStore.exportArtifact(artifact)}>
            {t('artifacts.export')}
          </button>
          <button
            type="button"
            className="btn"
            data-variant="danger"
            onClick={() => {
              void appStore.removeArtifact(artifact.id)
              onClose()
            }}
          >
            <IconTrash size={13} /> {t('settings.remove')}
          </button>
          <button type="button" className="btn" data-variant="primary" disabled={!dirty} onClick={() => void appStore.updateArtifact(artifact.id, { body })}>
            {t('settings.save')}
          </button>
        </div>

        {preview && artifact.kind === 'markdown' && <Markdown text={body} />}
        {preview && artifact.kind === 'html' && (
          <iframe
            title={t('artifacts.preview')}
            srcDoc={`<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{font:14px system-ui;padding:16px;color:#201d19}</style>${body}`}
            sandbox=""
            style={{ width: '100%', height: 420, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'white' }}
          />
        )}
        {preview && artifact.kind === 'svg' && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16, textAlign: 'center' }}>{body}</div>
        )}
        {(!preview || artifact.kind === 'text' || artifact.kind === 'code') && (
          <textarea
            className="input"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, minHeight: 340, resize: 'vertical' }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </div>
    </div>
  )
}

function NewArtifact({ t, onClose }: { t: Translate; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<ArtifactKind>('markdown')
  const [body, setBody] = useState('')

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(640px, 100%)' }}>
        <div className="modal__head">
          <div className="modal__title">{t('artifacts.new')}</div>
          <button type="button" className="icon-btn" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <div className="field">
          <label>{t('artifacts.title')}</label>
          <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>{t('artifacts.kind')}</label>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as ArtifactKind)}>
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t('artifacts.body')}</label>
          <textarea
            className="input"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, minHeight: 220 }}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" data-variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </button>
          <button
            type="button"
            className="btn"
            data-variant="primary"
            disabled={!title.trim() || !body.trim()}
            onClick={async () => {
              await appStore.createArtifact({ title: title.trim(), kind, body })
              onClose()
            }}
          >
            {t('artifacts.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
