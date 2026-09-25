import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Skill } from '@shared/types'
import type { Translate } from '../../i18n'
import { appStore } from '../../lib/store'
import { relativeTime } from '../../lib/format'
import { IconBolt, IconChevronDown, IconDots, IconFolder, IconPencil, IconPlus, IconSearch, IconSliders, IconTrash } from '../../components/Icons'

/** Kleinbuchstaben, Ziffern, Bindestriche. */
const NAMENSREGEL = /^[a-z0-9][a-z0-9-]{0,63}$/

interface Entwurf {
  name: string
  description: string
  body: string
  /** Gesetzt beim Bearbeiten — erlaubt das Umbenennen. */
  vorher?: string
}

/**
 * Anpassen → Skills. Eine Liste der eigenen Skills mit Suche, Anlegen,
 * Übernehmen aus einem Ordner, Ein- und Ausschalten — wie in der Vorlage.
 */
export function SkillsView({ t }: { t: Translate }) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [suche, setSuche] = useState('')
  const [entwurf, setEntwurf] = useState<Entwurf | null>(null)
  const [hinzuOffen, setHinzuOffen] = useState(false)
  const [meldung, setMeldung] = useState<string | null>(null)

  const laden = useCallback(async () => {
    setSkills(await window.desk.skills.list())
  }, [])

  useEffect(() => {
    void laden()
  }, [laden])

  const sichtbar = useMemo(() => {
    const wort = suche.trim().toLowerCase()
    if (!wort) return skills
    return skills.filter((skill) => skill.name.includes(wort) || skill.description.toLowerCase().includes(wort))
  }, [skills, suche])

  const importieren = async (): Promise<void> => {
    setHinzuOffen(false)
    try {
      const ergebnis = await window.desk.skills.importFolder()
      if (!ergebnis) return
      await laden()
      const teile = [t('skills.imported', { anzahl: String(ergebnis.neu.length) })]
      if (ergebnis.uebersprungen.length) teile.push(t('skills.skipped', { namen: ergebnis.uebersprungen.join(', ') }))
      setMeldung(teile.join(' '))
    } catch (fehler) {
      appStore.setError((fehler as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  return (
    <div className="main__scroll">
      <div className="pane skills">
        <div className="skills__kopf">
          <h2 className="skills__titel">{t('skills.title')}</h2>
          <span className="skills__zahl">{skills.length}</span>
          <div className="skills__suche">
            <IconSearch size={14} />
            <input
              className="input"
              placeholder={t('skills.search')}
              value={suche}
              onChange={(ereignis) => setSuche(ereignis.target.value)}
            />
          </div>
          <div style={{ position: 'relative' }}>
            <button type="button" className="btn" data-variant="primary" onClick={() => setHinzuOffen((offen) => !offen)} aria-haspopup="menu" aria-expanded={hinzuOffen}>
              <IconPlus size={14} /> {t('skills.add')} <IconChevronDown size={13} />
            </button>
            {hinzuOffen && (
              <AufKlickWeg onWeg={() => setHinzuOffen(false)}>
                <div className="skills__menue" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setHinzuOffen(false)
                      setEntwurf({ name: '', description: '', body: '' })
                    }}
                  >
                    <IconPencil size={14} />
                    <span>
                      <strong>{t('skills.create')}</strong>
                      <small>{t('skills.createHint')}</small>
                    </span>
                  </button>
                  <button type="button" role="menuitem" onClick={() => void importieren()}>
                    <IconFolder size={14} />
                    <span>
                      <strong>{t('skills.import')}</strong>
                      <small>{t('skills.importHint')}</small>
                    </span>
                  </button>
                </div>
              </AufKlickWeg>
            )}
          </div>
        </div>

        <p className="skills__erklaerung">{t('skills.intro')}</p>
        {meldung && (
          <div className="notice" onClick={() => setMeldung(null)} style={{ marginBottom: 12 }}>
            {meldung}
          </div>
        )}

        <h3 className="skills__gruppe">
          {t('skills.mine')} <span className="skills__zahl">{sichtbar.length}</span>
        </h3>

        {skills.length === 0 && <div className="skills__leer">{t('skills.empty')}</div>}
        {skills.length > 0 && sichtbar.length === 0 && <div className="skills__leer">{t('skills.noHit')}</div>}

        <ul className="skills__liste">
          {sichtbar.map((skill) => (
            <SkillZeile
              key={skill.name}
              skill={skill}
              t={t}
              onBearbeiten={() => setEntwurf({ name: skill.name, description: skill.description, body: skill.body, vorher: skill.name })}
              onGeaendert={() => void laden()}
            />
          ))}
        </ul>

        <button type="button" className="btn" data-variant="ghost" style={{ marginTop: 18 }} onClick={() => appStore.setSettingsOpen(true)}>
          <IconSliders size={14} /> {t('customize.open')}
        </button>
      </div>

      {entwurf && (
        <SkillEditor
          t={t}
          entwurf={entwurf}
          onAbbrechen={() => setEntwurf(null)}
          onGespeichert={async () => {
            setEntwurf(null)
            await laden()
          }}
        />
      )}
    </div>
  )
}

function SkillZeile({
  skill,
  t,
  onBearbeiten,
  onGeaendert
}: {
  skill: Skill
  t: Translate
  onBearbeiten: () => void
  onGeaendert: () => void
}) {
  const [menue, setMenue] = useState(false)

  const schalten = async (an: boolean): Promise<void> => {
    setMenue(false)
    await window.desk.skills.toggle(skill.name, an)
    onGeaendert()
  }

  return (
    <li className="skills__zeile" data-aus={skill.enabled ? undefined : 'true'}>
      <span className="skills__symbol" aria-hidden="true">
        <IconBolt size={16} />
      </span>
      <button type="button" className="skills__text" onClick={onBearbeiten} title={t('skills.edit')}>
        <span className="skills__name">
          {skill.name}
          {!skill.enabled && <span className="skills__marke">{t('skills.disabled')}</span>}
        </span>
        <span className="skills__beschreibung">
          {t('skills.byYou')} · {skill.description}
        </span>
      </button>
      {!skill.enabled && (
        <button type="button" className="btn" onClick={() => void schalten(true)}>
          {t('skills.enable')}
        </button>
      )}
      <span className="skills__datum">{relativeTime(skill.updatedAt, t)}</span>
      <div style={{ position: 'relative' }}>
        <button type="button" className="icon-btn" aria-label={t('skills.more')} title={t('skills.more')} onClick={() => setMenue((offen) => !offen)}>
          <IconDots size={16} />
        </button>
        {menue && (
          <AufKlickWeg onWeg={() => setMenue(false)}>
            <div className="skills__menue skills__menue--rechts" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenue(false)
                  onBearbeiten()
                }}
              >
                <IconPencil size={14} /> <span>{t('skills.edit')}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => void schalten(!skill.enabled)}>
                <IconBolt size={14} /> <span>{skill.enabled ? t('skills.disable') : t('skills.enable')}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenue(false)
                  void window.desk.skills.reveal(skill.name)
                }}
              >
                <IconFolder size={14} /> <span>{t('skills.reveal')}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-gefahr="true"
                onClick={async () => {
                  setMenue(false)
                  if (!confirm(t('skills.confirmRemove', { name: skill.name }))) return
                  await window.desk.skills.remove(skill.name)
                  onGeaendert()
                }}
              >
                <IconTrash size={14} /> <span>{t('settings.remove')}</span>
              </button>
            </div>
          </AufKlickWeg>
        )}
      </div>
    </li>
  )
}

function SkillEditor({
  t,
  entwurf,
  onAbbrechen,
  onGespeichert
}: {
  t: Translate
  entwurf: Entwurf
  onAbbrechen: () => void
  onGespeichert: () => Promise<void>
}) {
  const [wert, setWert] = useState<Entwurf>(entwurf)
  const [fehler, setFehler] = useState<string | null>(null)
  const [speichert, setSpeichert] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onAbbrechen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onAbbrechen])

  const nameOk = NAMENSREGEL.test(wert.name)

  const speichern = async (): Promise<void> => {
    if (!nameOk) return setFehler(t('skills.nameRule'))
    if (!wert.description.trim()) return setFehler(t('skills.needDescription'))
    if (!wert.body.trim()) return setFehler(t('skills.needBody'))
    setSpeichert(true)
    try {
      await window.desk.skills.save(wert)
      await onGespeichert()
    } catch (e) {
      setFehler((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setSpeichert(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onAbbrechen()}>
      <div className="modal skills__editor" role="dialog" aria-label={entwurf.vorher ? t('skills.edit') : t('skills.create')}>
        <div className="modal__head">
          <div className="modal__title">{entwurf.vorher ? t('skills.edit') : t('skills.create')}</div>
        </div>
        <div className="field">
          <label>{t('skills.name')}</label>
          <input
            className="input"
            autoFocus
            value={wert.name}
            placeholder="wochenbericht"
            aria-invalid={wert.name.length > 0 && !nameOk ? true : undefined}
            // Großbuchstaben und Leerzeichen gleich in die erlaubte Form bringen.
            onChange={(e) => setWert({ ...wert, name: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
          />
          <small className="skills__hilfe">{t('skills.nameRule')}</small>
        </div>
        <div className="field">
          <label>{t('skills.description')}</label>
          <textarea
            className="input"
            rows={2}
            value={wert.description}
            placeholder={t('skills.descriptionHint')}
            onChange={(e) => setWert({ ...wert, description: e.target.value })}
          />
        </div>
        <div className="field">
          <label>{t('skills.body')}</label>
          <textarea
            className="input skills__anleitung"
            rows={12}
            value={wert.body}
            placeholder={t('skills.bodyHint')}
            onChange={(e) => setWert({ ...wert, body: e.target.value })}
          />
        </div>
        {fehler && <div className="msg-error">{fehler}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
          <button type="button" className="btn" data-variant="ghost" onClick={onAbbrechen}>
            {t('action.cancel')}
          </button>
          <button type="button" className="btn" data-variant="primary" disabled={speichert} onClick={() => void speichern()}>
            {t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Schließt ein aufgeklapptes Menü bei Klick daneben oder mit Escape. */
function AufKlickWeg({ onWeg, children }: { onWeg: () => void; children: React.ReactNode }) {
  const huelle = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const unten = (ereignis: MouseEvent): void => {
      if (!huelle.current?.contains(ereignis.target as Node)) onWeg()
    }
    const taste = (ereignis: KeyboardEvent): void => {
      if (ereignis.key === 'Escape') onWeg()
    }
    window.addEventListener('mousedown', unten)
    window.addEventListener('keydown', taste)
    return () => {
      window.removeEventListener('mousedown', unten)
      window.removeEventListener('keydown', taste)
    }
  }, [onWeg])
  return <div ref={huelle}>{children}</div>
}
