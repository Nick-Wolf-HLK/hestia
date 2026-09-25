import { useEffect, useMemo, useState } from 'react'
import type { Erinnerung } from '@shared/types'
import type { Translate } from '../i18n'
import { appStore, useApp } from '../lib/store'
import { IconCheck, IconClose, IconPencil, IconPlus, IconTrash } from './Icons'

/**
 * Die Einträge eines Gedächtnisses — des allgemeinen (ohne `projectId`) oder
 * eines Projekts. Nach Thema gruppiert, jeder Eintrag einzeln änderbar und
 * löschbar. Legt das Modell mitten im Chat etwas ab, kommt
 * die Meldung über `onGeaendert`, und die Liste zieht nach.
 */
export function Erinnerungen({ projectId, t, kompakt = false }: { projectId?: string; t: Translate; kompakt?: boolean }) {
  const [eintraege, setEintraege] = useState<Erinnerung[]>([])
  const [bearbeitet, setBearbeitet] = useState<{ id?: string; thema: string; text: string } | null>(null)
  const [leerenFragen, setLeerenFragen] = useState(false)
  const aktiv = useApp((s) => s.settings.gedaechtnisAn)

  useEffect(() => {
    let lebt = true
    const laden = (): void => {
      void window.desk.gedaechtnis.liste(projectId).then((liste) => lebt && setEintraege(liste))
    }
    laden()
    const ab = window.desk.gedaechtnis.onGeaendert((geaendert) => {
      if ((geaendert ?? undefined) === projectId) laden()
    })
    return () => {
      lebt = false
      ab()
    }
  }, [projectId])

  const gruppen = useMemo(() => {
    const karte = new Map<string, Erinnerung[]>()
    for (const eintrag of eintraege) karte.set(eintrag.thema, [...(karte.get(eintrag.thema) ?? []), eintrag])
    return [...karte.entries()]
  }, [eintraege])

  const speichern = async (): Promise<void> => {
    if (!bearbeitet || !bearbeitet.text.trim()) return
    try {
      await window.desk.gedaechtnis.speichern({ ...bearbeitet, projectId })
      setBearbeitet(null)
      setEintraege(await window.desk.gedaechtnis.liste(projectId))
    } catch (fehler) {
      appStore.setError((fehler as Error).message)
    }
  }

  const loeschen = async (id: string): Promise<void> => {
    await window.desk.gedaechtnis.loeschen(id)
    setEintraege((liste) => liste.filter((e) => e.id !== id))
  }

  const formular = (
    <div className="erinnerung-form">
      <input
        className="input"
        placeholder={t('memory.topic')}
        value={bearbeitet?.thema ?? ''}
        maxLength={80}
        onChange={(e) => setBearbeitet((b) => (b ? { ...b, thema: e.target.value } : b))}
      />
      <textarea
        className="input"
        rows={2}
        autoFocus
        placeholder={t('memory.text')}
        value={bearbeitet?.text ?? ''}
        maxLength={2000}
        onChange={(e) => setBearbeitet((b) => (b ? { ...b, text: e.target.value } : b))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void speichern()
          }
          if (e.key === 'Escape') setBearbeitet(null)
        }}
      />
      <div className="erinnerung-form__knoepfe">
        <button type="button" className="btn" data-variant="ghost" onClick={() => setBearbeitet(null)}>
          {t('memory.cancel')}
        </button>
        <button type="button" className="btn" data-variant="primary" disabled={!bearbeitet?.text.trim()} onClick={() => void speichern()}>
          {t('memory.save')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="erinnerungen" data-kompakt={kompakt || undefined}>
      {!aktiv && <p className="erinnerungen__hinweis">{t('memory.off')}</p>}
      {eintraege.length === 0 && !bearbeitet && <p className="erinnerungen__leer">{t('memory.empty')}</p>}

      {gruppen.map(([thema, liste]) => (
        <div key={thema} className="erinnerungen__gruppe">
          <div className="erinnerungen__thema">{thema}</div>
          {liste.map((eintrag) =>
            bearbeitet?.id === eintrag.id ? (
              <div key={eintrag.id}>{formular}</div>
            ) : (
              <div key={eintrag.id} className="erinnerung">
                <p className="erinnerung__text">{eintrag.text}</p>
                <span className="erinnerung__knoepfe">
                  <button
                    type="button"
                    className="icon-btn"
                    title={t('memory.edit')}
                    aria-label={t('memory.edit')}
                    onClick={() => setBearbeitet({ id: eintrag.id, thema: eintrag.thema, text: eintrag.text })}
                  >
                    <IconPencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title={t('memory.delete')}
                    aria-label={t('memory.delete')}
                    onClick={() => void loeschen(eintrag.id)}
                  >
                    <IconTrash size={13} />
                  </button>
                </span>
              </div>
            )
          )}
        </div>
      ))}

      {bearbeitet && !bearbeitet.id && formular}

      <div className="erinnerungen__fuss">
        {!bearbeitet && (
          <button type="button" className="btn" data-variant="ghost" onClick={() => setBearbeitet({ thema: '', text: '' })}>
            <IconPlus size={13} /> {t('memory.add')}
          </button>
        )}
        {eintraege.length > 0 &&
          (leerenFragen ? (
            <span className="erinnerungen__frage">
              {t('memory.clearConfirm')}
              <button
                type="button"
                className="icon-btn"
                aria-label={t('memory.clear')}
                onClick={async () => {
                  await window.desk.gedaechtnis.leeren(projectId)
                  setEintraege([])
                  setLeerenFragen(false)
                }}
              >
                <IconCheck size={14} />
              </button>
              <button type="button" className="icon-btn" aria-label={t('memory.cancel')} onClick={() => setLeerenFragen(false)}>
                <IconClose size={14} />
              </button>
            </span>
          ) : (
            <button type="button" className="btn" data-variant="ghost" onClick={() => setLeerenFragen(true)}>
              {t('memory.clear')}
            </button>
          ))}
      </div>
    </div>
  )
}
