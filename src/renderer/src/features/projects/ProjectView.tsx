import { useEffect, useRef, useState } from 'react'
import type { ChatMode, PlannedTask, ProjektKontext } from '@shared/types'
import { startModell } from '@shared/startmodell'
import type { Translate } from '../../i18n'
import { appStore, useApp } from '../../lib/store'
import { relativeTime, toBase64 } from '../../lib/format'
import { Composer, type ComposerSubmit } from '../../components/Composer'
import { Erinnerungen } from '../../components/Erinnerungen'
import { describe } from '../planned/PlannedView'
import { IconCheck, IconClock, IconClose, IconFile, IconFolder, IconPencil, IconPin, IconPlus, IconTrash } from '../../components/Icons'

/**
 * Die Seite eines Projekts: links das Eingabefeld
 * und die Chats des Projekts, rechts Anweisungen, Erinnerungen, Kontext,
 * Ordner und Geplant. Jeder Chat, der hier beginnt, gehört zum Projekt und
 * kennt damit dessen Anweisungen, Gedächtnis und Dateien.
 */
export function ProjectView({ t }: { t: Translate }) {
  const projektId = useApp((s) => s.activeProjectId)
  const projekt = useApp((s) => s.projects.find((p) => p.id === s.activeProjectId))
  const chats = useApp((s) => s.chats)
  const settings = useApp((s) => s.settings)

  const [mode, setMode] = useState<ChatMode>('chat')
  const [model, setModel] = useState<string | undefined>(startModell(settings, 'chat'))
  useEffect(() => {
    setModel((aktuell) => aktuell ?? startModell(settings, 'chat'))
  }, [settings])
  const [umbenennen, setUmbenennen] = useState<string | null>(null)
  const [loeschenFragen, setLoeschenFragen] = useState(false)

  // Ein anderes Projekt geöffnet: frisch beginnen.
  useEffect(() => {
    setMode('chat')
    setUmbenennen(null)
    setLoeschenFragen(false)
  }, [projektId])

  if (!projekt) {
    return (
      <div className="main__scroll">
        <div className="pane">
          <button type="button" className="btn" data-variant="ghost" onClick={() => appStore.go('projects')}>
            {t('project.back')}
          </button>
        </div>
      </div>
    )
  }

  const projektChats = chats.filter((c) => c.projectId === projekt.id).sort((a, b) => b.updatedAt - a.updatedAt)

  const submit = async (payload: ComposerSubmit): Promise<void> => {
    if (mode === 'agent' && !projekt.folder) {
      appStore.setError(t('home.needsFolder'))
      return
    }
    const chat = await appStore.newChat(mode, mode === 'agent' ? projekt.folder : undefined, projekt.permissionMode, projekt.id)
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

  const namenSpeichern = async (): Promise<void> => {
    const name = umbenennen?.trim()
    setUmbenennen(null)
    if (name && name !== projekt.name) await appStore.updateProject(projekt.id, { name })
  }

  return (
    <div className="main__scroll">
      <div className="pane pane--wide projektseite">
        <nav className="projektseite__pfad" aria-label={t('project.back')}>
          <button type="button" onClick={() => appStore.go('projects')}>
            {t('project.back')}
          </button>
          <span aria-hidden>/</span>
          <span className="projektseite__pfadname">{projekt.name}</span>
        </nav>

        <header className="projektseite__kopf">
          {umbenennen !== null ? (
            <input
              className="input projektseite__namensfeld"
              autoFocus
              value={umbenennen}
              maxLength={120}
              onChange={(e) => setUmbenennen(e.target.value)}
              onBlur={() => void namenSpeichern()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void namenSpeichern()
                if (e.key === 'Escape') setUmbenennen(null)
              }}
            />
          ) : (
            <h1 className="pane__title projektseite__titel">{projekt.name}</h1>
          )}
          <div className="projektseite__aktionen">
            <button
              type="button"
              className="icon-btn"
              data-active={projekt.pinned || undefined}
              title={projekt.pinned ? t('chat.unpin') : t('chat.pin')}
              aria-label={projekt.pinned ? t('chat.unpin') : t('chat.pin')}
              onClick={() => void appStore.updateProject(projekt.id, { pinned: !projekt.pinned })}
            >
              <IconPin size={15} />
            </button>
            <button type="button" className="icon-btn" title={t('project.rename')} aria-label={t('project.rename')} onClick={() => setUmbenennen(projekt.name)}>
              <IconPencil size={15} />
            </button>
            {loeschenFragen ? (
              <span className="projektseite__frage">
                <span>{t('project.deleteConfirm', { name: projekt.name })}</span>
                <button type="button" className="btn" data-variant="danger" onClick={() => void appStore.removeProject(projekt.id)}>
                  <IconTrash size={13} /> {t('project.delete')}
                </button>
                <button type="button" className="btn" data-variant="ghost" onClick={() => setLoeschenFragen(false)}>
                  {t('memory.cancel')}
                </button>
              </span>
            ) : (
              <button type="button" className="icon-btn" title={t('project.delete')} aria-label={t('project.delete')} onClick={() => setLoeschenFragen(true)}>
                <IconTrash size={15} />
              </button>
            )}
          </div>
        </header>

        <div className="projektseite__raster">
          <div className="projektseite__haupt">
            <Composer
              t={t}
              mode={mode}
              onModeChange={setMode}
              folder={projekt.folder}
              blocked={mode === 'agent' && !projekt.folder ? t('home.needsFolder') : undefined}
              model={model}
              onModelSelect={setModel}
              onSubmit={(payload) => void submit(payload)}
              placeholder={t('project.placeholder')}
            />

            <h2 className="projektseite__abschnitt">{t('project.recent')}</h2>
            {projektChats.length === 0 ? (
              <p className="projektseite__leer">{t('project.noChats')}</p>
            ) : (
              <ul className="projektchats">
                {projektChats.map((chat) => (
                  <li key={chat.id}>
                    <button type="button" className="projektchats__zeile" onClick={() => void appStore.openChat(chat.id)}>
                      <span className="projektchats__titel">{chat.title}</span>
                      <span className="projektchats__zeit">{relativeTime(chat.updatedAt, t)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <aside className="projektseite__leiste">
            <Anweisungen projektId={projekt.id} text={projekt.instructions ?? ''} t={t} />
            <section className="projektkarte">
              <h3 className="projektkarte__titel">{t('project.memory')}</h3>
              <p className="projektkarte__hinweis">{t('project.memoryHint')}</p>
              <Erinnerungen projectId={projekt.id} t={t} kompakt />
            </section>
            <Kontext projektId={projekt.id} t={t} />
            <section className="projektkarte">
              <div className="projektkarte__kopf">
                <h3 className="projektkarte__titel">{t('project.folder')}</h3>
              </div>
              {projekt.folder ? (
                <div className="projektordner">
                  <IconFolder size={14} />
                  <span className="projektordner__pfad" title={projekt.folder}>
                    {projekt.folder}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    title={t('project.folderRemove')}
                    aria-label={t('project.folderRemove')}
                    onClick={() => void appStore.updateProject(projekt.id, { folder: '' })}
                  >
                    <IconClose size={13} />
                  </button>
                </div>
              ) : (
                <p className="projektkarte__hinweis">{t('project.folderHint')}</p>
              )}
              <button
                type="button"
                className="btn"
                data-variant="ghost"
                onClick={async () => {
                  const gewaehlt = await window.desk.dialogs.pickFolder(projekt.folder)
                  if (gewaehlt) await appStore.updateProject(projekt.id, { folder: gewaehlt })
                }}
              >
                <IconFolder size={13} /> {t('project.folderPick')}
              </button>
            </section>
            <Geplant projektId={projekt.id} folder={projekt.folder} t={t} />
          </aside>
        </div>
      </div>
    </div>
  )
}

/** Anweisungen: angezeigt als Text, ein Klick macht ein Feld daraus. */
function Anweisungen({ projektId, text, t }: { projektId: string; text: string; t: Translate }) {
  const [entwurf, setEntwurf] = useState<string | null>(null)
  const speichern = async (): Promise<void> => {
    if (entwurf === null) return
    const neu = entwurf.trim()
    setEntwurf(null)
    if (neu !== text.trim()) await appStore.updateProject(projektId, { instructions: neu })
  }
  return (
    <section className="projektkarte">
      <div className="projektkarte__kopf">
        <h3 className="projektkarte__titel">{t('project.instructions')}</h3>
        {entwurf === null && (
          <button type="button" className="icon-btn" title={t('memory.edit')} aria-label={t('memory.edit')} onClick={() => setEntwurf(text)}>
            {text ? <IconPencil size={14} /> : <IconPlus size={14} />}
          </button>
        )}
      </div>
      {entwurf !== null ? (
        <div className="erinnerung-form">
          <textarea className="input" rows={6} autoFocus value={entwurf} onChange={(e) => setEntwurf(e.target.value)} />
          <div className="erinnerung-form__knoepfe">
            <button type="button" className="btn" data-variant="ghost" onClick={() => setEntwurf(null)}>
              {t('memory.cancel')}
            </button>
            <button type="button" className="btn" data-variant="primary" onClick={() => void speichern()}>
              <IconCheck size={13} /> {t('memory.save')}
            </button>
          </div>
        </div>
      ) : text ? (
        <p className="projektkarte__text" onClick={() => setEntwurf(text)}>
          {text}
        </p>
      ) : (
        <p className="projektkarte__hinweis">{t('project.instructionsHint')}</p>
      )}
    </section>
  )
}

/** Kontext: die Dateien des Projekts mit Füllstand und Hinweis auf den Suchmodus. */
function Kontext({ projektId, t }: { projektId: string; t: Translate }) {
  const [kontext, setKontext] = useState<ProjektKontext | null>(null)
  const [liest, setLiest] = useState<string[]>([])
  const eingabe = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let lebt = true
    void window.desk.kontext.liste(projektId).then((k) => lebt && setKontext(k))
    return () => {
      lebt = false
    }
  }, [projektId])

  const hinzu = async (dateien: File[]): Promise<void> => {
    for (const datei of dateien) {
      setLiest((l) => [...l, datei.name])
      try {
        setKontext(await window.desk.kontext.hinzu(projektId, datei.name, await toBase64(datei)))
      } catch (fehler) {
        appStore.setError((fehler as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      } finally {
        setLiest((l) => l.filter((name) => name !== datei.name))
      }
    }
  }

  const prozent = kontext ? Math.min(100, Math.round((kontext.zeichen / kontext.kapazitaet) * 1000) / 10) : 0

  return (
    <section className="projektkarte">
      <div className="projektkarte__kopf">
        <h3 className="projektkarte__titel">{t('project.context')}</h3>
        <button type="button" className="icon-btn" title={t('project.contextAdd')} aria-label={t('project.contextAdd')} onClick={() => eingabe.current?.click()}>
          <IconPlus size={14} />
        </button>
      </div>
      <p className="projektkarte__hinweis">{t('project.contextHint')}</p>
      {kontext && kontext.dateien.length > 0 && (
        <>
          <div className="kontextleiste" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={prozent}>
            <span style={{ width: `${Math.max(prozent, 1.5)}%` }} />
          </div>
          <div className="kontextstand">
            <span>{t('project.contextUsed', { prozent: prozent.toLocaleString('de-DE') })}</span>
            <span className="kontextstand__modus" data-suche={kontext.suchmodus || undefined} title={kontext.suchmodus ? t('project.contextSearchHint') : t('project.contextFullHint')}>
              ● {kontext.suchmodus ? t('project.contextSearch') : t('project.contextFull')}
            </span>
          </div>
        </>
      )}
      <div className="kontextdateien">
        {kontext?.dateien.map((datei) => (
          <div key={datei.id} className="kontextdatei" title={`${datei.name} · ${Math.round(datei.zeichen / 100) / 10} Tsd. Zeichen`}>
            <IconFile size={18} />
            <span className="kontextdatei__name">{datei.name}</span>
            <span className="kontextdatei__art">{datei.art}</span>
            <button
              type="button"
              className="icon-btn kontextdatei__weg"
              title={t('project.contextRemove')}
              aria-label={t('project.contextRemove')}
              onClick={async () => setKontext(await window.desk.kontext.loeschen(projektId, datei.id))}
            >
              <IconClose size={12} />
            </button>
          </div>
        ))}
        {liest.map((name) => (
          <div key={name} className="kontextdatei" data-liest>
            <IconFile size={18} />
            <span className="kontextdatei__name">{name}</span>
            <span className="kontextdatei__art">{t('project.contextReading')}</span>
          </div>
        ))}
      </div>
      {kontext && kontext.dateien.length === 0 && liest.length === 0 && <p className="projektkarte__leer">{t('project.contextEmpty')}</p>}
      <button type="button" className="btn" data-variant="ghost" onClick={() => eingabe.current?.click()}>
        <IconPlus size={13} /> {t('project.contextAdd')}
      </button>
      <input
        ref={eingabe}
        type="file"
        multiple
        className="visually-hidden"
        accept=".pdf,.docx,.odt,.html,.htm,.txt,.md,.markdown,.csv,.json,.xml,.yaml,.yml,text/*"
        onChange={(e) => {
          const dateien = Array.from(e.target.files ?? [])
          e.target.value = ''
          void hinzu(dateien)
        }}
      />
    </section>
  )
}

/** Geplant: die Aufträge des Projekts; „+“ öffnet das Formular in Geplant mit Projektbezug. */
function Geplant({ projektId, folder, t }: { projektId: string; folder?: string; t: Translate }) {
  const [auftraege, setAuftraege] = useState<PlannedTask[]>([])
  useEffect(() => {
    let lebt = true
    const laden = (): void => {
      void window.desk.planned.list().then((liste) => lebt && setAuftraege(liste.filter((a) => a.projectId === projektId)))
    }
    laden()
    const ab = window.desk.planned.onChanged(laden)
    return () => {
      lebt = false
      ab()
    }
  }, [projektId])

  const neu = (): void => appStore.planeImProjekt({ projectId: projektId, mode: 'chat', folder })

  return (
    <section className="projektkarte">
      <div className="projektkarte__kopf">
        <h3 className="projektkarte__titel">{t('project.scheduled')}</h3>
        <button type="button" className="icon-btn" title={t('planned.new')} aria-label={t('planned.new')} onClick={neu}>
          <IconPlus size={14} />
        </button>
      </div>
      {auftraege.length === 0 ? (
        <p className="projektkarte__hinweis">{t('project.scheduledHint')}</p>
      ) : (
        <ul className="projektplan">
          {auftraege.map((auftrag) => (
            <li key={auftrag.id} className="projektplan__zeile" data-aus={!auftrag.enabled || undefined}>
              <IconClock size={13} />
              <span className="projektplan__titel">{auftrag.title}</span>
              <span className="projektplan__wann">{describe(auftrag, t)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
