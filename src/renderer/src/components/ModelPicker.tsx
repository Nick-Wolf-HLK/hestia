import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ModelInfo, ReasoningChoice } from '@shared/types'
import { startModell } from '@shared/startmodell'
import { IconCheck, IconChevronDown, IconChevronRight, IconSearch } from './Icons'
import { appStore, useApp } from '../lib/store'
import type { Translate } from '../i18n'

interface Props {
  value?: string
  onSelect: (reference: string) => void
  t: Translate
}

/** Die Reihenfolge ist die des Menüs: vom Modell entscheiden lassen bis viel. */
const STUFEN: ReasoningChoice[] = ['auto', 'off', 'low', 'medium', 'high']
/** So viele zuletzt genutzte Modelle stehen oben, der Rest unter „Weitere Modelle“. */
const OBEN_HOECHSTENS = 5
const MENUE_BREITE = 340
const SEITE_BREITE = 300

type Seitenmenue = 'aufwand' | 'modelle' | null

/** Zeigt das Gerät mit einer Maus? Auf dem Handy feuert ein Tipp vorher ein
 *  künstliches mouseenter — das darf das Seitenmenü nicht schon öffnen. */
function mitMaus(): boolean {
  return window.matchMedia('(hover: hover)').matches
}

function referenceOf(model: ModelInfo): string {
  return `${model.providerId}|${model.id}`
}

function label(reference: string | undefined, models: ModelInfo[], t: Translate): string {
  if (!reference) return t('home.modelNone')
  const found = models.find((m) => referenceOf(m) === reference)
  return found?.label ?? reference.split('|').slice(1).join('|') ?? reference
}

/**
 * Modellwahl im Eingabefeld:
 *
 * - oben die zuletzt genutzten Modelle, jedes mit einer Zeile, was es kann;
 * - darunter „Aufwand“ mit der aktuellen Stufe; es klappt seitlich ein
 *   Untermenü auf, mit Erklärung, Häkchen und der Marke „Standard“;
 * - ganz unten „Weitere Modelle“ mit allen übrigen, durchsuchbar.
 *
 * Die Stufe gilt je Modell. Wer nichts eigens wählt, bekommt die allgemeine
 * Vorgabe aus den Einstellungen — die trägt die Marke „Standard“.
 */
export function ModelPicker({ value, onSelect, t }: Props) {
  const models = useApp((s) => s.models)
  const settings = useApp((s) => s.settings)
  const providers = useApp((s) => s.providers)
  const chats = useApp((s) => s.chats)
  const [open, setOpen] = useState(false)
  const [seite, setSeite] = useState<Seitenmenue>(null)
  const [suche, setSuche] = useState('')
  /** Wohin das Menü aufgeht: nach oben, wenn unten kein Platz ist; die Seite dorthin, wo Platz ist. */
  const [lage, setLage] = useState<{ oben: boolean; seiteLinks: boolean }>({ oben: true, seiteLinks: false })
  const [seitenHoehe, setSeitenHoehe] = useState(0)
  const host = useRef<HTMLDivElement>(null)
  const menue = useRef<HTMLDivElement>(null)
  const zeileAufwand = useRef<HTMLButtonElement>(null)
  const zeileModelle = useRef<HTMLButtonElement>(null)
  const seitenmenue = useRef<HTMLDivElement>(null)

  const anbieterName = (id: string): string => providers.find((p) => p.id === id)?.label ?? id

  const selected = models.find((m) => referenceOf(m) === value)
  const eigene = value ? settings.reasoning[value] : undefined
  const wirksam: ReasoningChoice = eigene ?? settings.effort
  const denkbar = selected?.capabilities.thinking === true

  /**
   * Die in den Einstellungen angehakten Modelle — dann genau diese, in der
   * gewählten Reihenfolge. Ohne Auswahl: das gewählte, die Vorgabe und die
   * zuletzt in Gesprächen genutzten.
   */
  const auswahl = useMemo(() => settings.modellauswahl ?? [], [settings.modellauswahl])
  const festgelegt = auswahl.length > 0
  const oben = useMemo(() => {
    const bekannt = new Set(models.map(referenceOf))
    if (auswahl.length > 0) {
      // Das Modell, das gerade im Knopf steht, gehört immer dazu — sonst zeigt
      // der Knopf ein Modell, das im Menü fehlt, und nirgends sitzt ein Haken.
      const reihe = value && bekannt.has(value) && !auswahl.includes(value) ? [value, ...auswahl] : auswahl
      return reihe.filter((ref) => bekannt.has(ref)).map((ref) => models.find((m) => referenceOf(m) === ref)!)
    }
    const reihe: string[] = []
    const nimm = (ref?: string): void => {
      if (ref && bekannt.has(ref) && !reihe.includes(ref)) reihe.push(ref)
    }
    nimm(value)
    nimm(startModell(settings))
    for (const chat of [...chats].sort((a, b) => b.updatedAt - a.updatedAt)) nimm(chat.model)
    for (const model of models) nimm(referenceOf(model))
    return reihe.slice(0, OBEN_HOECHSTENS).map((ref) => models.find((m) => referenceOf(m) === ref)!)
  }, [models, chats, value, settings, auswahl])

  const alleGefiltert = useMemo(() => {
    const wort = suche.trim().toLowerCase()
    const treffer = models.filter((m) => !wort || m.label.toLowerCase().includes(wort) || anbieterName(m.providerId).toLowerCase().includes(wort))
    const gruppen = new Map<string, ModelInfo[]>()
    for (const model of treffer) {
      const liste = gruppen.get(model.providerId) ?? []
      liste.push(model)
      gruppen.set(model.providerId, liste)
    }
    return [...gruppen.entries()]
    // anbieterName hängt nur an providers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, suche, providers])

  const beschreibung = (model: ModelInfo): string => {
    const teile = [anbieterName(model.providerId)]
    if (model.capabilities.thinking) teile.push(t('models.cap.thinking'))
    if (model.capabilities.tools) teile.push(t('models.cap.tools'))
    if (model.capabilities.vision) teile.push(t('models.cap.vision'))
    if (model.contextLength) teile.push(`${Math.round(model.contextLength / 1024)}k`)
    return teile.join(' · ')
  }

  const aufmachen = (mitSeite: Seitenmenue = null): void => {
    const rahmen = host.current?.getBoundingClientRect()
    if (rahmen) {
      // Nach unten, wenn dort genug Platz ist (Startseite), sonst nach oben (Gespräch).
      const unten = window.innerHeight - rahmen.bottom
      const oben_ = rahmen.top
      // Das Menü schließt rechts mit der Pille ab; die Seite geht dorthin, wo Platz ist.
      const rechtsFrei = window.innerWidth - rahmen.right
      setLage({ oben: unten < 420 && oben_ > unten, seiteLinks: rechtsFrei < SEITE_BREITE + 16 })
    }
    setSuche('')
    setSeite(mitSeite)
    setOpen(true)
  }

  const zu = (): void => {
    setOpen(false)
    setSeite(null)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!host.current?.contains(event.target as Node)) zu()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Erst das Seitenmenü, dann das Menü.
      if (seite) setSeite(null)
      else zu()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, seite])

  // Das Seitenmenü steht auf Höhe seiner Zeile — wie in der Vorlage. Ragte es
  // unten aus dem Fenster (Menü geht im Gespräch nach oben auf, „Aufwand“ sitzt
  // dann tief), rückt es so weit hoch, wie nötig.
  useLayoutEffect(() => {
    if (!seite) return
    const zeile = seite === 'aufwand' ? zeileAufwand.current : zeileModelle.current
    const kasten = seitenmenue.current
    let hoehe = zeile?.offsetTop ?? 0
    if (zeile && kasten) {
      const zeilenOben = zeile.getBoundingClientRect().top
      const ueberstand = zeilenOben + kasten.offsetHeight - (window.innerHeight - 8)
      if (ueberstand > 0) hoehe -= ueberstand
    }
    setSeitenHoehe(hoehe)
  }, [seite, open])

  const waehleStufe = (stufe: ReasoningChoice): void => {
    if (!value) return
    void appStore.setReasoning(value, stufe)
    zu()
  }

  const modellZeile = (model: ModelInfo, klein = false) => {
    const ref = referenceOf(model)
    const aktiv = ref === value
    return (
      <button
        key={ref}
        type="button"
        role="menuitemradio"
        aria-checked={aktiv}
        className={klein ? 'modellmenue__modell modellmenue__modell--klein' : 'modellmenue__modell'}
        onClick={() => {
          onSelect(ref)
          zu()
        }}
      >
        <span className="modellmenue__zeilen">
          <span className="modellmenue__name">{model.label}</span>
          {!klein && <span className="modellmenue__beschreibung">{beschreibung(model)}</span>}
        </span>
        {aktiv && <IconCheck size={15} className="modellmenue__hak" />}
      </button>
    )
  }

  return (
    <div ref={host} className="modellwahl" style={{ position: 'relative' }}>
      <button
        type="button"
        className="pill"
        onClick={() => (open ? zu() : aufmachen())}
        title={t('home.modelNone')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="pill__text">{label(value, models, t)}</span>
        {value && (
          <span
            className="pill__note pill__note--schaltbar"
            title={t('reasoning.toggleHere')}
            onPointerDown={(ereignis) => ereignis.stopPropagation()}
            onClick={(ereignis) => {
              ereignis.stopPropagation()
              if (open && seite === 'aufwand') zu()
              else aufmachen('aufwand')
            }}
          >
            {t(`reasoning.${wirksam}`)}
          </span>
        )}
        <IconChevronDown size={13} />
      </button>

      {open && (
        <div
          ref={menue}
          className="modellmenue"
          role="menu"
          data-richtung={lage.oben ? 'oben' : 'unten'}
          style={{ width: MENUE_BREITE }}
        >
          {oben.length === 0 && <div className="modellmenue__leer">{t('models.empty')}</div>}
          {oben.map((model) => modellZeile(model))}

          {value && (
            <>
              <div className="modellmenue__trenner" />
              <button
                ref={zeileAufwand}
                type="button"
                className="modellmenue__zeile"
                data-offen={seite === 'aufwand' || undefined}
                aria-haspopup="menu"
                aria-expanded={seite === 'aufwand'}
                onMouseEnter={() => mitMaus() && setSeite('aufwand')}
                // Mit Maus: öffnen, nie umschalten — wer darüberfährt, hat es schon
                // offen, ein Klick darf es nicht wieder zuklappen. Auf dem Handy
                // gibt es kein Darüberfahren: dort klappt der Tipp auf und zu.
                onClick={() => setSeite((jetzt) => (jetzt === 'aufwand' && !mitMaus() ? null : 'aufwand'))}
              >
                <span className="modellmenue__name">{t('reasoning.menu')}</span>
                <span className="modellmenue__wert">{t(`reasoning.${wirksam}`)}</span>
                <IconChevronRight size={14} />
              </button>
              {seite === 'aufwand' && value && (
                <div
                  ref={seitenmenue}
                  className="stufenliste"
                  role="menu"
                  aria-label={t('reasoning.menu')}
                  data-seite={lage.seiteLinks ? 'links' : 'rechts'}
                  style={{ top: seitenHoehe, width: SEITE_BREITE }}
                >
                  <p className="stufenliste__grund">{denkbar ? t('reasoning.flyoutHint') : t('reasoning.notCapable')}</p>
                  {STUFEN.map((stufe) => (
                    <button
                      key={stufe}
                      type="button"
                      role="menuitemradio"
                      aria-checked={wirksam === stufe}
                      className="stufenliste__punkt"
                      title={t(`reasoning.${stufe}.lang`)}
                      onClick={() => waehleStufe(stufe)}
                    >
                      <span className="stufenliste__name">{t(`reasoning.${stufe}`)}</span>
                      {settings.effort === stufe && <span className="stufenliste__marke">{t('reasoning.default')}</span>}
                      <span className="stufenliste__hak">{wirksam === stufe ? <IconCheck size={15} /> : null}</span>
                    </button>
                  ))}
                  {eigene !== undefined && (
                    <button type="button" className="stufenliste__zurueck" onClick={() => {
                      void appStore.setReasoning(value, null)
                      zu()
                    }}>
                      {t('reasoning.reset')}
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          <div className="modellmenue__trenner" />
          {festgelegt ? (
            <button
              type="button"
              className="modellmenue__zeile"
              onClick={() => {
                zu()
                appStore.setSettingsOpen(true, 'models')
              }}
            >
              <span className="modellmenue__name">{t('models.changePick')}</span>
              <span className="modellmenue__wert">{t('settings.modelPickCount', { anzahl: String(auswahl.length), hoechstens: '5' })}</span>
            </button>
          ) : (
            <button
              ref={zeileModelle}
              type="button"
              className="modellmenue__zeile"
              data-offen={seite === 'modelle' || undefined}
              aria-haspopup="menu"
              aria-expanded={seite === 'modelle'}
              onMouseEnter={() => mitMaus() && setSeite('modelle')}
              onClick={() => setSeite((jetzt) => (jetzt === 'modelle' && !mitMaus() ? null : 'modelle'))}
            >
              <span className="modellmenue__name">{t('models.more')}</span>
              <span className="modellmenue__wert">{models.length}</span>
              <IconChevronRight size={14} />
            </button>
          )}

          {seite === 'modelle' && (
            <div
              className="stufenliste stufenliste--modelle"
              role="menu"
              aria-label={t('models.more')}
              data-seite={lage.seiteLinks ? 'links' : 'rechts'}
              style={{ width: SEITE_BREITE + 20, ...(lage.oben ? { bottom: 0 } : { top: 0 }) }}
            >
              <div className="modellmenue__suche">
                <IconSearch size={13} />
                <input
                  className="input"
                  autoFocus
                  placeholder={t('models.search')}
                  value={suche}
                  onChange={(ereignis) => setSuche(ereignis.target.value)}
                />
              </div>
              <div className="modellmenue__alle">
                {alleGefiltert.length === 0 && <div className="modellmenue__leer">{t('models.noHit')}</div>}
                {alleGefiltert.map(([anbieter, liste]) => (
                  <div key={anbieter}>
                    <div className="modellmenue__gruppe">{anbieterName(anbieter)}</div>
                    {liste.map((model) => modellZeile(model, true))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
