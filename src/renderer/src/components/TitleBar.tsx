import { useEffect, useState } from 'react'
import { IconBack, IconClose, IconForward, IconMinus, IconPanel, IconSearch, IconSquare } from './Icons'
import { appStore, useApp } from '../lib/store'
import { makeT } from '../i18n'

/** Eigene Fensterleiste: Navigation, Seitentitel, Fenstersteuerung. */
export function TitleBar() {
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const view = useApp((s) => s.view)
  const t = makeT(useApp((s) => s.settings.language))
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.desk.win.isMaximized().then(setMaximized)
    // Die Abbestellung kommt aus dem Abo selbst.
    return window.desk.win.onStateChanged((state) => setMaximized(state.maximized))
  }, [])

  return (
    <header className="titlebar">
      <button
        type="button"
        className="icon-btn"
        data-active={sidebarOpen}
        title={sidebarOpen ? t('toolbar.sidebarHide') : t('toolbar.sidebarShow')}
        onClick={() => appStore.toggleSidebar()}
      >
        <IconPanel size={17} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t('toolbar.back')}
        onClick={() => window.history.back()}
        style={{ marginLeft: 2 }}
      >
        <IconBack size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={t('toolbar.forward')}
        onClick={() => window.history.forward()}
        style={{ opacity: 0.6 }}
      >
        <IconForward size={16} />
      </button>

      <span style={{ fontSize: 12.5, color: 'var(--text-faint)', marginLeft: 6, textTransform: 'capitalize' }}>
        {viewLabel(view, t)}
      </span>

      <div className="titlebar__spacer" />

      <button
        type="button"
        className="icon-btn"
        title={t('toolbar.search')}
        onClick={() => appStore.setSearchOpen(true)}
        style={{ marginRight: 4 }}
      >
        <IconSearch size={16} />
      </button>

      {/* Im Browser gibt es kein Fenster zu steuern — das tut der Browser. */}
      {!window.desk.fern && (
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <button type="button" className="icon-btn" title={t('toolbar.minimize')} onClick={() => void window.desk.win.minimize()}>
          <IconMinus size={16} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={maximized ? t('toolbar.restore') : t('toolbar.maximize')}
          onClick={() => void window.desk.win.toggleMaximize()}
        >
          <IconSquare size={14} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={t('toolbar.close')}
          onClick={() => void window.desk.win.close()}
          style={{ color: 'var(--danger)' }}
        >
          <IconClose size={16} />
        </button>
      </div>
      )}
    </header>
  )
}

/** Interner Ansichtsname → sichtbarer, übersetzter Begriff. */
function viewLabel(view: string, t: ReturnType<typeof makeT>): string {
  const key = `view.${view}` as const
  const label = t(key as never)
  return typeof label === 'string' && label !== key ? label : view
}
