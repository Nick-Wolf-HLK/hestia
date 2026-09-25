import { useEffect, useState } from 'react'
import type { SearchHit } from '@shared/ipc'
import type { Translate } from '../../i18n'
import { appStore } from '../../lib/store'
import { relativeTime } from '../../lib/format'
import { IconClock, IconFolder, IconLayers, IconSearch } from '../../components/Icons'

export function SearchModal({ t }: { t: Translate }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => {
      void window.desk.search.all(query).then(setHits)
    }, 120)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => setIndex(0), [hits])

  const close = () => appStore.setSearchOpen(false)

  // Die Flucht-Taste muss das Fenster immer schließen — auch dann, wenn der
  // Fokus gerade woanders liegt (etwa nach einem Klick in die Trefferliste).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // Der Schluss ist eine stabile Ladenfunktion; die Abhängigkeit beim Namen
    // wäre bei jedem Rendern eine neue.
  }, [])

  const open = (hit: SearchHit) => {
    close()
    void appStore.openChat(hit.id)
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" style={{ width: 'min(620px, 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <IconSearch size={16} />
          <input
            className="search-input"
            style={{ border: 0, background: 'transparent', padding: 0 }}
            autoFocus
            placeholder={t('search.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, hits.length - 1))
              if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0))
              if (e.key === 'Enter' && hits[index]) open(hits[index]!)
            }}
          />
        </div>

        {hits.length === 0 && <div style={{ color: 'var(--text-faint)', padding: '8px 2px' }}>{t('search.empty')}</div>}
        {hits.map((hit, i) => (
          <button
            key={`${hit.kind}-${hit.id}-${i}`}
            type="button"
            className="result-row"
            data-active={i === index}
            onMouseEnter={() => setIndex(i)}
            onClick={() => open(hit)}
          >
            {hit.kind === 'project' ? <IconLayers size={15} /> : hit.kind === 'message' ? <IconFolder size={15} /> : <IconClock size={15} />}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block' }}>{hit.title}</span>
              {hit.subtitle && <span className="result-row__sub">{hit.subtitle}</span>}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{relativeTime(hit.updatedAt, t)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
