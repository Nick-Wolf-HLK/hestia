import { useEffect, useMemo, useState } from 'react'
import type { ChatMode, PermissionMode } from '@shared/types'
import { startModell } from '@shared/startmodell'
import type { Translate } from '../../i18n'
import { greetingFor } from '@shared/branding'
import { appStore, useApp } from '../../lib/store'
import { Composer, type ComposerSubmit } from '../../components/Composer'
import { LogoMark, IconFolder, IconCheck } from '../../components/Icons'
import { relativeTime } from '../../lib/format'

/** Begrüßungsbildschirm: Gruß, Composer, Agent-Steuerung, aktive Aufgaben. */
export function Home({ t }: { t: Translate }) {
  const settings = useApp((s) => s.settings)
  const chats = useApp((s) => s.chats)
  const streamingByChat = useApp((s) => s.streamingByChat)
  // Unveränderliche Referenz selektieren; die Auswertung erfolgt im useMemo.
  const permissionList = useApp((s) => s.permissions)
  const pendingCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of permissionList) map.set(entry.chatId, (map.get(entry.chatId) ?? 0) + 1)
    return map
  }, [permissionList])
  const boot = useApp((s) => s.boot)

  // Ein neues Gespräch beginnt im Chat. Welchen Modus das letzte hatte, ist
  // dessen Sache: Agent ist eine Entscheidung für diesen Auftrag, keine
  // Voreinstellung, die sich über alle neuen Gespräche legt.
  const [mode, setMode] = useState<ChatMode>('chat')
  const [folder, setFolder] = useState<string | undefined>()
  // Zugriffsstufe für den Auftrag, der hier beginnt. Vorgabe ist die sichere.
  const [permission, setPermission] = useState<PermissionMode>('ask')
  const [model, setModel] = useState<string | undefined>(startModell(settings, 'chat'))
  // Beim ersten Start kommt die Vorgabe erst nach dem Laden — dann übernehmen.
  useEffect(() => {
    setModel((aktuell) => aktuell ?? startModell(settings, mode))
  }, [settings, mode])
  const [tab, setTab] = useState<'folder' | 'manual' | 'output'>('folder')

  const activeTasks = chats
    .filter((c) => c.mode === 'agent')
    .slice(0, 6)

  const submit = async (payload: ComposerSubmit): Promise<void> => {
    // Agent ohne Ordner läuft ins Leere — vorher melden statt den Lauf zu starten.
    if (mode === 'agent' && !folder) {
      appStore.setError('Für den Agenten zuerst einen Arbeitsordner wählen.')
      return
    }
    const chat = await appStore.newChat(mode, mode === 'agent' ? folder : undefined, permission)
    if (model) await appStore.setChatModel(chat.id, model)
    await appStore.openChat(chat.id)
    await appStore.sendMessage({
      chatId: chat.id,
      text: payload.text,
      images: payload.images,
      files: payload.files,
      model: model ?? startModell(settings, mode),
      suche: payload.suche
    })
  }

  const pickFolder = async (): Promise<void> => {
    const picked = await window.desk.dialogs.pickFolder(folder)
    if (picked) setFolder(picked)
  }

  return (
    <div className="home">
      <h1 className="home__greeting">
        <span className="home__logo">
          <LogoMark size={30} />
        </span>
        {greetingFor(new Date(), settings.displayName || undefined)}
      </h1>

      <Composer
        t={t}
        mode={mode}
        blocked={mode === 'agent' && !folder ? t('home.needsFolder') : undefined}
        permissionMode={permission}
        onPermission={setPermission}
        onModeChange={(next) => {
          setMode(next)
          // Das Modell folgt dem Modus, solange es noch die Vorgabe der anderen
          // Stufe ist — sonst lief ein Agent-Auftrag mit dem Chat-Modell los.
          setModel((aktuell) => {
            if (aktuell === startModell(settings, mode)) return startModell(settings, next)
            return aktuell
          })
        }}
        folder={folder}
        onPickFolder={mode === 'agent' ? pickFolder : undefined}
        model={model}
        onModelSelect={setModel}
        onSubmit={(payload) => void submit(payload)}
        autoFocus
      />

      {mode === 'agent' && (
        <>
          <div className="agent-strip">
            <div className="segmented" role="tablist">
              {(
                [
                  ['folder', t('home.tabFolder')],
                  ['manual', t('home.tabManual')],
                  ['output', t('home.tabOutput')]
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  data-active={tab === value}
                  onClick={() => setTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === 'folder' && (
              <button type="button" className="folder-chip" data-set={folder ? 'true' : 'false'} onClick={() => void pickFolder()}>
                <IconFolder size={14} />
                {folder ? folder.split(/[\\/]/).filter(Boolean).slice(-1)[0] : t('home.workInFolder')}
              </button>
            )}
          </div>

          <div className="task-section">
            <div className="task-section__title">{t('home.active')}</div>
            {activeTasks.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-faint)', padding: '6px 0' }}>{t('home.noActive')}</div>
            )}
            {activeTasks.map((task) => {
              const running = Boolean(streamingByChat[task.id])
              const needsPermission = (pendingCounts.get(task.id) ?? 0) > 0
              const status = needsPermission
                ? t('status.needsPermission')
                : running
                  ? t('status.running')
                  : t('status.done')
              return (
                <div className="task-row" key={task.id}>
                  <span className="dot" data-tone={needsPermission ? 'warning' : running ? undefined : 'done'} />
                  <div className="task-row__main">
                    <div className="task-row__title">{task.title}</div>
                    <div className="task-row__meta">
                      {status} · {relativeTime(task.updatedAt, t)}
                    </div>
                  </div>
                  <button type="button" className="btn" onClick={() => void appStore.openChat(task.id)}>
                    {needsPermission ? t('action.review') : running ? t('status.running') : t('action.review')}
                    {!running && <IconCheck size={13} />}
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}

      <div style={{ textAlign: 'center', marginTop: 18, color: 'var(--text-faint)', fontSize: 12 }}>
        {boot?.branding.name} · {boot?.branding.tagline}
      </div>
    </div>
  )
}
