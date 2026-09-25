import { useEffect, useState } from 'react'
import { makeT } from './i18n'
import { applyTheme, appStore, useApp } from './lib/store'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { Home } from './features/home/Home'
import { SkillsView } from './features/skills/SkillsView'
import { ChatView } from './features/chat/ChatView'
import { ProjectsView } from './features/projects/ProjectsView'
import { ProjectView } from './features/projects/ProjectView'
import { ArtifactsView } from './features/artifacts/ArtifactsView'
import { MobileView } from './features/mobile/MobileView'
import { startModell } from '@shared/startmodell'
import { PlannedView } from './features/planned/PlannedView'
import { SettingsModal } from './features/settings/SettingsModal'
import { SearchModal } from './features/search/SearchModal'

let autoRan = false

export function App() {
  const ready = useApp((s) => s.ready)
  const view = useApp((s) => s.view)
  const language = useApp((s) => s.settings.language)
  const settingsOpen = useApp((s) => s.settingsOpen)
  const searchOpen = useApp((s) => s.searchOpen)
  const error = useApp((s) => s.error)
  const sidebarState = useApp((s) => (s.sidebarOpen ? 'open' : 'closed'))
  const activeChatId = useApp((s) => s.activeChatId)
  const t = makeT(language)

  // Auf dem Handy ist die Leiste eine Schublade: zu beim Start, und sie geht
  // von selbst zu, sobald ein Gespräch oder eine Seite gewählt ist.
  useEffect(() => {
    if (window.matchMedia('(max-width: 760px)').matches) appStore.toggleSidebar(false)
  }, [view, activeChatId])

  // Stream-Ereignisse aus dem Hauptprozess in den Zustand übernehmen.
  useEffect(() => window.desk.messages.onStreamEvent((event) => appStore.applyStreamEvent(event)), [])
  // Klick auf eine Meldung des Rechners: gleich im richtigen Gespräch landen.
  useEffect(() => window.desk.app.onOpenChat((chatId) => void appStore.openChat(chatId)), [])

  // Automatisierter Prüflauf: sendet einen Prompt, ohne dass jemand tippt.
  const autoPrompt = useApp((s) => s.boot?.autoPrompt)
  const modelsReady = useApp((s) => s.models.length > 0)
  useEffect(() => {
    if (!autoPrompt || !modelsReady || autoRan) return
    autoRan = true
    void (async () => {
      const boot = appStore.get().boot
      const settings = appStore.get().settings
      const mode = boot?.autoMode ?? 'chat'
      const chat = await appStore.newChat(mode, mode === 'agent' ? boot?.autoFolder : undefined)
      await appStore.openChat(chat.id)
      await appStore.sendMessage({
        chatId: chat.id,
        text: autoPrompt,
        model: startModell(settings, mode),
      })
    })()
  }, [autoPrompt, modelsReady])

  useEffect(() => appStore.watchPermissions(), [])

  // System-Thema live übernehmen, solange "System folgen" aktiv ist.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      const settings = appStore.get().settings
      if (settings.theme === 'system') applyTheme(settings, media.matches)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return
      if (event.key.toLowerCase() === 'n' && !event.shiftKey) {
        event.preventDefault()
        void appStore.newChat()
      } else if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        appStore.setSearchOpen(true)
      } else if (event.key.toLowerCase() === 's' && event.shiftKey) {
        event.preventDefault()
        appStore.toggleSidebar()
      } else if (event.key === ',') {
        event.preventDefault()
        appStore.setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!ready) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>…</div>
    )
  }

  return (
    <div className="app-shell" data-sidebar={sidebarState}>
      <TitleBar />
      <Sidebar t={t} />
      <div className="schublade-grund" onClick={() => appStore.toggleSidebar(false)} />
      <main className="main">
        {view === 'home' && <Home t={t} />}
        {view === 'chat' && <ChatView t={t} />}
        {view === 'projects' && <ProjectsView t={t} />}
        {view === 'project' && <ProjectView t={t} />}
        {view === 'artifacts' && <ArtifactsView t={t} />}
        {view === 'scheduled' && <PlannedView t={t} />}
        {view === 'dispatch' && <MobileView t={t} />}
        {view === 'customize' && <SkillsView t={t} />}
      </main>

      {settingsOpen && <SettingsModal t={t} />}
      {searchOpen && <SearchModal t={t} />}

      {error && (
        <div
          className="notice"
          style={{ position: 'fixed', bottom: 16, right: 16, maxWidth: 420, zIndex: 80, boxShadow: 'var(--shadow-lg)' }}
          onClick={() => appStore.setError(undefined)}
        >
          {error}
        </div>
      )}
      <Fehlerbruecke />
    </div>
  )
}

/**
 * Der letzte Fänger.
 *
 * Siebenunddreißig Knöpfe rufen die Hauptseite an, ohne auf die Antwort zu
 * warten (`void …`). Wenn dort etwas ablehnt — „Der Zeitpunkt liegt in der
 * Vergangenheit." — ging der Grund bisher kommentarlos unter: Der Knopf wirkte
 * nicht, und niemand konnte sagen, warum. Was sonst unverlangt bleibt, zeigt
 * diese Brücke, bis jemand es zur Kenntnis nimmt.
 */
function Fehlerbruecke() {
  const t = makeT(useApp((sprache) => sprache.settings.language))
  const [meldungen, setMeldungen] = useState<string[]>([])
  useEffect(() => {
    const zeige = (grund: unknown): void => {
      const text = grund instanceof Error ? grund.message : String(grund ?? '')
      if (!text.trim()) return
      setMeldungen((vorher) => (vorher.includes(text) ? vorher : [...vorher, text]))
    }
    const beiAbweisung = (ereignis: PromiseRejectionEvent): void => {
      ereignis.preventDefault()
      zeige(ereignis.reason)
    }
    const beiFehler = (ereignis: ErrorEvent): void => zeige(ereignis.error ?? ereignis.message)
    window.addEventListener('unhandledrejection', beiAbweisung)
    window.addEventListener('error', beiFehler)
    return () => {
      window.removeEventListener('unhandledrejection', beiAbweisung)
      window.removeEventListener('error', beiFehler)
    }
  }, [])
  if (!meldungen.length) return null
  return (
    <div className="fehlerbruecke" role="alert">
      {meldungen.map((meldung) => (
        <p key={meldung} className="fehlerbruecke__zeile">
          {meldung}
        </p>
      ))}
      <button type="button" className="fehlerbruecke__zu" aria-label={t('errors.dismiss')} onClick={() => setMeldungen([])}>
        ✕
      </button>
    </div>
  )
}
