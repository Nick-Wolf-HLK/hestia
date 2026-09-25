import { useState } from 'react'
import type { Translate } from '../i18n'
import type { ViewName } from '../lib/store'
import { appStore, useApp } from '../lib/store'
import { relativeTime, baseName } from '../lib/format'
import {
  IconChevronRight,
  IconGlobe,
  IconPanel,
  IconClock,
  IconGrid,
  IconLayers,
  IconPencil,
  IconPhone,
  IconPin,
  IconSearch,
  IconSliders,
  IconSpark,
  IconTrash
} from './Icons'

const PRIMARY: { view: ViewName; key: Parameters<Translate>[0]; icon: React.ReactNode; badge?: string }[] = [
  { view: 'projects', key: 'nav.projects', icon: <IconLayers size={16} /> },
  { view: 'artifacts', key: 'nav.artifacts', icon: <IconSpark size={16} /> },
  { view: 'scheduled', key: 'nav.scheduled', icon: <IconClock size={16} /> },
  { view: 'dispatch', key: 'nav.dispatch', icon: <IconPhone size={16} /> },
  { view: 'customize', key: 'nav.customize', icon: <IconSliders size={16} /> }
]

export function Sidebar({ t }: { t: Translate }) {
  const chats = useApp((s) => s.chats)
  const projects = useApp((s) => s.projects)
  const view = useApp((s) => s.view)
  const activeChatId = useApp((s) => s.activeChatId)
  const settings = useApp((s) => s.settings)
  const streamingByChat = useApp((s) => s.streamingByChat)
  const boot = useApp((s) => s.boot)
  const [moreOpen, setMoreOpen] = useState(false)
  const [menue, setMenue] = useState(false)

  const pinned = chats.filter((c) => c.pinned)

  return (
    <nav className="sidebar" aria-label={boot?.branding.shortName}>
      <div className="nav-list">
        <button type="button" className="nav-item" data-active={view === 'home'} onClick={() => void appStore.newChat('chat')}>
          <IconGrid size={16} />
          <span className="nav-item__label">{t('nav.new')}</span>
        </button>
        {PRIMARY.map((item) => (
          <button
            key={item.view}
            type="button"
            className="nav-item"
            data-active={view === item.view}
            onClick={() => appStore.go(item.view)}
          >
            {item.icon}
            <span className="nav-item__label">{t(item.key)}</span>
            {item.badge && <span className="badge">{item.badge}</span>}
          </button>
        ))}
        <button type="button" className="nav-item" onClick={() => setMoreOpen((v) => !v)}>
          <IconChevronRight size={14} style={{ transform: moreOpen ? 'rotate(90deg)' : 'none', transition: 'transform 140ms ease' }} />
          <span className="nav-item__label">{t('nav.more')}</span>
        </button>
        {moreOpen && (
          <div style={{ paddingLeft: 14 }}>
            <button
              type="button"
              className="nav-item"
              onClick={() => {
                appStore.setSettingsOpen(true)
                setMoreOpen(false)
              }}
            >
              <IconSliders size={15} />
              <span className="nav-item__label">{t('settings.title')}</span>
            </button>
          </div>
        )}
      </div>

      {pinned.length > 0 && (
        <>
          <div className="sidebar__section">{t('nav.pinned')}</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {pinned.map((chat) => (
              <ChatRow key={chat.id} chat={chat} t={t} active={chat.id === activeChatId} streaming={Boolean(streamingByChat[chat.id])} />
            ))}
          </div>
        </>
      )}

      <div className="sidebar__section">
        <span style={{ flex: 1 }}>{t('nav.chats')}</span>
        <button
          type="button"
          className="icon-btn"
          style={{ width: 22, height: 22 }}
          title={t('search.placeholder')}
          onClick={() => appStore.setSearchOpen(true)}
        >
          <IconSearch size={14} />
        </button>
      </div>

      <div className="chat-list">
        {chats
          .filter((c) => !c.pinned)
          .map((chat) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              t={t}
              active={chat.id === activeChatId}
              streaming={Boolean(streamingByChat[chat.id])}
            />
          ))}
        {projects.length > 0 && (
          <button type="button" className="nav-item" onClick={() => appStore.go('projects')} style={{ marginTop: 4 }}>
            <IconLayers size={15} />
            <span className="nav-item__label">
              {t('nav.workspaces')} · {projects.length}
            </span>
          </button>
        )}
      </div>

      <div className="sidebar__footer" style={{ position: 'relative' }}>
        {menue && (
          <>
            <div className="fußmenue__fänger" onClick={() => setMenue(false)} />
            <div className="fußmenue" role="menu">
              <div className="fußmenue__konto">
                {settings.displayName || 'Lokal'}
                <span className="fußmenue__stand">{boot?.keychainAvailable ? 'Schlüsselbund aktiv' : 'Ohne Schlüsselbund'}</span>
              </div>
              <button type="button" role="menuitem" onClick={() => { setMenue(false); appStore.setSettingsOpen(true) }}>
                <IconSliders size={15} /> {t('settings.title')}
                <span className="fußmenue__kurzzeichen">Strg ,</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenue(false)
                  void appStore.saveSettings({ language: settings.language === 'de' ? 'en' : 'de' })
                }}
              >
                <IconGlobe size={15} /> {settings.language === 'de' ? 'English' : 'Deutsch'}
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenue(false); appStore.toggleSidebar() }}>
                <IconPanel size={15} /> {t('toolbar.sidebarHide')}
              </button>
            </div>
          </>
        )}
        <button
          type="button"
          data-fussausloeser=""
          aria-haspopup="menu"
          aria-expanded={menue}
          style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, padding: 4 }}
          onClick={() => setMenue((wert) => !wert)}
        >
          <span className="avatar">{(settings.displayName || 'L').slice(0, 1).toUpperCase()}</span>
          <span style={{ minWidth: 0, textAlign: 'left' }}>
            <span style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {settings.displayName || 'Lokal'}
            </span>
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>
              {boot?.keychainAvailable ? 'Schlüsselbund aktiv' : 'Ohne Schlüsselbund'}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="icon-btn"
          title={t('settings.title')}
          onClick={() => appStore.setSettingsOpen(true)}
        >
          <IconSliders size={16} />
        </button>
      </div>
    </nav>
  )
}

function ChatRow({
  chat,
  t,
  active,
  streaming
}: {
  chat: import('@shared/types').Chat
  t: Translate
  active: boolean
  streaming: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(chat.title)

  const commit = async (): Promise<void> => {
    setEditing(false)
    const next = draft.trim()
    if (!next || next === chat.title) {
      setDraft(chat.title)
      return
    }
    await appStore.renameChat(chat.id, next)
  }

  if (editing) {
    return (
      <div className="chat-row" data-active={active}>
        <input
          className="input chat-row__edit"
          value={draft}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') void commit()
            if (e.key === 'Escape') {
              setDraft(chat.title)
              setEditing(false)
            }
          }}
        />
      </div>
    )
  }

  return (
    <div
      className="chat-row"
      data-active={active}
      role="button"
      tabIndex={0}
      onClick={() => void appStore.openChat(chat.id)}
      onDoubleClick={() => {
        setDraft(chat.title)
        setEditing(true)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void appStore.openChat(chat.id)
        if (e.key === 'F2') {
          setDraft(chat.title)
          setEditing(true)
        }
      }}
    >
      <span className="dot" style={{ opacity: streaming ? 1 : chat.pinned ? 0.5 : 0, background: streaming ? 'var(--accent)' : 'var(--text-faint)' }} />
      <span className="chat-row__title" title={t('chat.renameHint')}>
        {chat.title}
      </span>
      <span className="chat-row__meta" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
        {relativeTime(chat.updatedAt, t)}
      </span>
      <span className="chat-row__actions">
        <button
          type="button"
          className="icon-btn"
          style={{ width: 22, height: 22 }}
          title={t('chat.rename')}
          onClick={(e) => {
            e.stopPropagation()
            setDraft(chat.title)
            setEditing(true)
          }}
        >
          <IconPencil size={13} />
        </button>
        <button
          type="button"
          className="icon-btn"
          style={{ width: 22, height: 22 }}
          title={chat.pinned ? t('chat.unpin') : t('chat.pin')}
          onClick={(e) => {
            e.stopPropagation()
            void appStore.pinChat(chat.id)
          }}
        >
          <IconPin size={13} />
        </button>
        <button
          type="button"
          className="icon-btn"
          style={{ width: 22, height: 22 }}
          title={t('chat.delete')}
          onClick={(e) => {
            e.stopPropagation()
            void appStore.deleteChat(chat.id)
          }}
        >
          <IconTrash size={13} />
        </button>
      </span>
    </div>
  )
}

export function folderLabel(path: string | undefined): string {
  return baseName(path)
}
