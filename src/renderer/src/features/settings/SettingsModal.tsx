import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProviderConfig } from '@shared/types'
import type { Translate } from '../../i18n'
import { appStore, useApp } from '../../lib/store'
import { Erinnerungen } from '../../components/Erinnerungen'
import {
  IconBox,
  IconBulb,
  IconCheck,
  IconClose,
  IconCpu,
  IconGlobe,
  IconKeyboard,
  IconPlus,
  IconSearch,
  IconShield,
  IconSliders,
  IconTrash
} from '../../components/Icons'

/** Die Abschnitte der linken Spalte; Gruppen bekommen eine Überschrift. */
type Abschnitt = 'appearance' | 'language' | 'shortcuts' | 'models' | 'memory' | 'permissions' | 'behaviour' | 'data'

type Eintrag = { wert: Abschnitt; titel: string; icon: typeof IconSliders; wort: string }

const GRUPPEN: Array<{ schlussel: string; titel: string; eintraege: Eintrag[] }> = [
  {
    schlussel: 'arbeitsflaeche',
    titel: 'Arbeitsfläche',
    eintraege: [
      { wert: 'appearance', titel: 'Darstellung', icon: IconSliders, wort: 'aussehen farbe thema hell dunkel schriftbewegung' },
      { wert: 'language', titel: 'Sprache', icon: IconGlobe, wort: 'sprache deutsch english name ruf' },
      { wert: 'shortcuts', titel: 'Tastatur', icon: IconKeyboard, wort: 'tastatur kurzbefehl shortcut' }
    ]
  },
  {
    schlussel: 'modelle',
    titel: 'Modelle',
    eintraege: [
      { wert: 'models', titel: 'Modelle und Anbieter', icon: IconCpu, wort: 'modell anbieter ollama reasoning denkstufe schlüssel start öffnen zuletzt festes modell' },
      { wert: 'memory', titel: 'Gedächtnis', icon: IconBulb, wort: 'gedächtnis erinnerung merken vergessen memory sensibel' },
      { wert: 'permissions', titel: 'Freigaben', icon: IconShield, wort: 'freigabe zugriff erlauben befehl schreiben' }
    ]
  },
  {
    schlussel: 'app',
    titel: 'App',
    eintraege: [
      { wert: 'behaviour', titel: 'Verhalten', icon: IconBox, wort: 'abmeldfenster ablage wachhalten leiste' },
      { wert: 'data', titel: 'Daten und Stand', icon: IconSliders, wort: 'daten pfad schlüsselbund platform standsinfo' }
    ]
  }
]

export function SettingsModal({ t }: { t: Translate }) {
  const settings = useApp((s) => s.settings)
  const boot = useApp((s) => s.boot)
  const providers = useApp((s) => s.providers)
  const models = useApp((s) => s.models)
  const startAbschnitt = useApp((s) => s.settingsAbschnitt) as Abschnitt | undefined
  const [abschnitt, setAbschnitt] = useState<Abschnitt>(startAbschnitt ?? 'appearance')
  const [suche, setSuche] = useState('')
  const [testErgebnis, setTestErgebnis] = useState<Record<string, string>>({})

  // Auf dem Handy ist die Leiste eine seitlich wischbare Reihe: der gewählte
  // Punkt muss darin sichtbar sein, auch wenn man direkt hineinspringt.
  // Nur die Leiste selbst rollen: scrollIntoView rollte auch den Inhalt
  // daneben seitlich weg (Elemente mit overflow: hidden lassen sich per Code
  // verschieben).
  useEffect(() => {
    const punkt = document.querySelector<HTMLElement>('.einstellungen__punkt[data-aktiv="true"]')
    const leiste = punkt?.closest<HTMLElement>('.einstellungen__nav')
    if (!punkt || !leiste) return
    if (leiste.scrollWidth > leiste.clientWidth) {
      leiste.scrollLeft = punkt.offsetLeft - (leiste.clientWidth - punkt.offsetWidth) / 2
    } else if (leiste.scrollHeight > leiste.clientHeight) {
      const oben = punkt.offsetTop - leiste.offsetTop
      if (oben < leiste.scrollTop || oben + punkt.offsetHeight > leiste.scrollTop + leiste.clientHeight) leiste.scrollTop = oben - 8
    }
  }, [abschnitt])
  const chatAnzahl = useApp((s) => s.chats).length
  const projektAnzahl = useApp((s) => s.projects).length

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') appStore.setSettingsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const schliessen = () => appStore.setSettingsOpen(false)

  /** Die Suche filtert die linke Spalte — nach Namen und nach Beispielen. */
  const sichtbar = useMemo(() => {
    const wort = suche.trim().toLowerCase()
    if (!wort) return GRUPPEN
    return GRUPPEN.map((gruppe) => ({
      ...gruppe,
      eintraege: gruppe.eintraege.filter((eintrag) => `${eintrag.wort} ${eintrag.titel}`.toLowerCase().includes(wort))
    })).filter((gruppe) => gruppe.eintraege.length > 0)
  }, [suche])

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && schliessen()}>
      <div className="einstellungen" role="dialog" aria-modal="true" aria-label={t('settings.title')}>
        <aside className="einstellungen__leiste">
          <label className="einstellungen__suche">
            <IconSearch size={14} />
            <input value={suche} placeholder={t('settings.search')} onChange={(e) => setSuche(e.target.value)} />
          </label>
          <nav className="einstellungen__nav">
            {sichtbar.map((gruppe) => (
              <div key={gruppe.titel} className="einstellungen__gruppe">
                <div className="einstellungen__kopf">{t(('settings.gruppe.' + gruppe.schlussel) as never)}</div>
                {gruppe.eintraege.map((eintrag) => (
                  <button
                    key={eintrag.wert}
                    type="button"
                    className="einstellungen__punkt"
                    data-aktiv={abschnitt === eintrag.wert}
                    onClick={() => setAbschnitt(eintrag.wert)}
                  >
                    <eintrag.icon size={15} />
                    <span>{t(('settings.section.' + eintrag.wert) as never)}</span>
                  </button>
                ))}
              </div>
            ))}
            {sichtbar.length === 0 && <div className="einstellungen__leer">{t('settings.searchEmpty')}</div>}
          </nav>
        </aside>

        <div className="einstellungen__inhalt">
          <header className="einstellungen__titelzeile">
            <h2>{t(`settings.section.${abschnitt}`)}</h2>
            <button type="button" className="icon-btn" onClick={schliessen} aria-label={t('settings.close')}>
              <IconClose />
            </button>
          </header>

          {abschnitt === 'appearance' && (
            <>
              <Block titel={t('settings.design')}>
                <Zeile titel={t('settings.design')} text={t('settings.design.hint')}>
                  <div className="segmented">
                    {(['system', 'light', 'dark'] as const).map((wert) => (
                      <button
                        key={wert}
                        type="button"
                        data-active={settings.theme === wert}
                        onClick={() => void appStore.saveSettings({ theme: wert })}
                      >
                        {t(`settings.theme.${wert}`)}
                      </button>
                    ))}
                  </div>
                </Zeile>
                <Zeile titel={t('settings.fontSize')} text={t('settings.fontSize.hint')}>
                <div className="schriftstufe">
                  <input
                    type="range"
                    min={80}
                    max={160}
                    step={5}
                    value={settings.schriftstufe || 100}
                    onChange={(ereignis) => void appStore.saveSettings({ schriftstufe: Number(ereignis.target.value) })}
                  />
                  <span className="schriftstufe__wert">{settings.schriftstufe || 100}&nbsp;%</span>
                  <button type="button" className="btn" onClick={() => void appStore.saveSettings({ schriftstufe: 100 })}>
                    {t('settings.fontSize.reset')}
                  </button>
                </div>
              </Zeile>
              <Zeile titel={t('settings.startView')} text={t('settings.startView.hint')}>
                  <Auswahl
                    wert={settings.startView}
                    optionen={[
                      ['home', t('settings.startView.home')],
                      // Der Wert muß der Einrichtung entsprechen: `lastChat`, nicht `last`.
                      // Aus `last` wurde ein Abbruch beim Speichern — der Knopf wirkte
                      // nicht, und niemand sah einen Fehler.
                      ['lastChat', t('settings.startView.last')]
                    ]}
                    setze={(wert) => void appStore.saveSettings({ startView: wert as 'home' | 'lastChat' })}
                  />
                </Zeile>
                <Zeile titel={t('settings.sourceView')} text={t('settings.sourceView.hint')}>
                  <Umschalter an={settings.panelSourceView} setze={(wert) => void appStore.saveSettings({ panelSourceView: wert })} />
                </Zeile>
              </Block>
            </>
          )}

          {abschnitt === 'language' && (
            <Block titel={t('settings.voice')}>
              <Zeile titel={t('settings.language')} text={t('settings.language.hint')}>
                <Auswahl
                  wert={settings.language}
                  optionen={[
                    ['de', 'Deutsch'],
                    ['en', 'English']
                  ]}
                  setze={(wert) => void appStore.saveSettings({ language: wert as 'de' | 'en' })}
                />
              </Zeile>
              <Zeile titel={t('settings.displayName')} text={t('settings.displayName.hint')}>
                <input
                  className="input"
                  style={{ width: 210 }}
                  value={settings.displayName}
                  onChange={(e) => void appStore.saveSettings({ displayName: e.target.value })}
                />
              </Zeile>
            </Block>
          )}

          {abschnitt === 'shortcuts' && (
            <Block titel={t('settings.shortcuts')}>
              {(
                [
                  [t('settings.shortcut.newChat'), '⌘/Ctrl + N'],
                  [t('settings.shortcut.search'), '⌘/Ctrl + K'],
                  [t('settings.shortcut.settings'), '⌘/Ctrl + ,'],
                  [t('settings.shortcut.escape'), 'Esc']
                ] as Array<[string, string]>
              ).map(([befehl, tasten]) => (
                <Zeile key={tasten} titel={befehl}>
                  <code className="tasten">{tasten}</code>
                </Zeile>
              ))}
            </Block>
          )}

          {abschnitt === 'models' && (
            <>
              {!boot?.keychainAvailable && <div className="notice">{t('settings.keychainMissing')}</div>}
              <Block titel={t('settings.startModel')}>
                <Zeile titel={t('settings.startModel')} text={t('settings.startModel.hint')}>
                  <div className="segmented">
                    {(['zuletzt', 'fest'] as const).map((wert) => (
                      <button
                        key={wert}
                        type="button"
                        data-active={settings.modellBeimStart === wert}
                        onClick={() => {
                          // Beim Umschalten auf „fest“ ohne Wahl: das bisher benutzte übernehmen.
                          const vorschlag = settings.defaultModelChat || settings.zuletztModell
                          void appStore.saveSettings(
                            wert === 'fest' && vorschlag
                              ? { modellBeimStart: wert, defaultModelChat: vorschlag, defaultModelAgent: vorschlag }
                              : { modellBeimStart: wert }
                          )
                        }}
                      >
                        {t(`settings.startModel.${wert}`)}
                      </button>
                    ))}
                  </div>
                </Zeile>
                {settings.modellBeimStart === 'fest' ? (
                  <Zeile titel={t('settings.startModel.fixed')}>
                    <Auswahl
                      wert={settings.defaultModelChat ?? ''}
                      optionen={[
                        ...(settings.defaultModelChat && !models.some((m) => `${m.providerId}|${m.id}` === settings.defaultModelChat)
                          ? [[settings.defaultModelChat, settings.defaultModelChat.split('|').slice(1).join('|')] as [string, string]]
                          : []),
                        ...models.map((m) => [`${m.providerId}|${m.id}`, m.label] as [string, string])
                      ]}
                      setze={(wert) => void appStore.saveSettings({ defaultModelChat: wert, defaultModelAgent: wert })}
                    />
                  </Zeile>
                ) : (
                  settings.zuletztModell && (
                    <div className="hinweis">
                      {t('settings.startModel.current', { model: settings.zuletztModell.split('|').slice(1).join('|') })}
                    </div>
                  )
                )}
              </Block>

              <Block titel={t('settings.modelPick')}>
                <ModellAuswahl t={t} />
              </Block>

              <Block titel={t('settings.reasoning')}>
                <Zeile titel={t('settings.reasoning')} text={t('settings.reasoning.hint')}>
                  <div className="segmented">
                    {(['auto', 'off', 'low', 'medium', 'high'] as const).map((wert) => (
                      <button
                        key={wert}
                        type="button"
                        title={t(`reasoning.${wert}.lang`)}
                        data-active={settings.effort === wert}
                        onClick={() => void appStore.saveSettings({ effort: wert })}
                      >
                        {t(`reasoning.${wert}`)}
                      </button>
                    ))}
                  </div>
                </Zeile>
                <div className="hinweis">{t('reasoning.defaultHint')}</div>
              </Block>

              <Block titel={t('settings.providerGroup')}>
                {/* Aus der Ferne nur ansehen: Anbieter ändern hieße, Gespräche an
                    einen anderen Server umzuleiten — das entscheidet man am Rechner. */}
                {window.desk.fern ? (
                  <>
                    <p className="hinweis">{t('settings.providersRemote')}</p>
                    {providers.map((provider) => (
                      <div key={provider.id} className="anbieter anbieter--nurlesen">
                        <strong>{provider.label}</strong>
                        <span className="hinweis">{provider.kind} · {provider.baseUrl} · {models.filter((m) => m.providerId === provider.id).length} Modell(e)</span>
                      </div>
                    ))}
                  </>
                ) : (<>
                {providers.map((provider) => (
                  <ProviderEditor
                    key={provider.id}
                    provider={provider}
                    t={t}
                    modelCount={models.filter((m) => m.providerId === provider.id).length}
                    testResult={testErgebnis[provider.id]}
                    onTested={(id, nachricht) => setTestErgebnis((bisher) => ({ ...bisher, [id]: nachricht }))}
                  />
                ))}
                <div className="anbieter__aktionen">
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      void appStore.saveProvider({
                        id: `custom-${Date.now()}`,
                        label: 'Neuer Anbieter',
                        kind: 'openai',
                        baseUrl: 'http://127.0.0.1:1234/v1',
                        hasKey: false,
                        enabled: true
                      })
                    }
                  >
                    <IconPlus size={14} /> {t('settings.addProvider')}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      void appStore.saveProvider({
                        id: 'llama-cpp',
                        label: 'llama.cpp',
                        kind: 'llama',
                        baseUrl: 'http://127.0.0.1:8080/v1',
                        hasKey: false,
                        enabled: true
                      })
                    }
                  >
                    <IconPlus size={14} /> llama.cpp
                  </button>
                  <button type="button" className="btn" onClick={() => void appStore.refreshModels(true)}>
                    {t('settings.reloadModels')}
                  </button>
                  <span className="zahl">{models.length}</span>
                </div>
                </>)}
              </Block>
            </>
          )}

          {abschnitt === 'permissions' && (
            <Block titel={t('settings.permissions')}>
              <Zeile titel={t('settings.autoApproveWrites')} text={t('settings.autoApproveWrites.hint')}>
                <Umschalter an={settings.autoApproveWrites} setze={(wert) => void appStore.saveSettings({ autoApproveWrites: wert })} />
              </Zeile>
              <Zeile titel={t('settings.allowCommands')} text={t('settings.allowCommands.hint')}>
                <Umschalter an={settings.allowCommands} setze={(wert) => void appStore.saveSettings({ allowCommands: wert })} />
              </Zeile>
              <div className="hinweis">{t('settings.permissions.hint')}</div>
            </Block>
          )}

          {abschnitt === 'behaviour' && (
            <Block titel={t('settings.behaviour')}>
              <Zeile titel={t('settings.tray')} text={t('settings.tray.hint')}>
                <Umschalter an={settings.minimizeToTray} setze={(wert) => void appStore.saveSettings({ minimizeToTray: wert })} />
              </Zeile>
              <Zeile titel={t('settings.keepAwake')} text={t('settings.keepAwake.hint')}>
                <Umschalter an={settings.keepAwake} setze={(wert) => void appStore.saveSettings({ keepAwake: wert })} />
              </Zeile>
            </Block>
          )}

          {abschnitt === 'memory' && (
            <>
              <Block titel={t('settings.section.memory')}>
                <Zeile titel={t('settings.memory.use')} text={t('settings.memory.useHint')}>
                  <Umschalter an={settings.gedaechtnisAn} setze={(wert) => void appStore.saveSettings({ gedaechtnisAn: wert })} />
                </Zeile>
                <Zeile titel={t('settings.memory.chats')} text={t('settings.memory.chatsHint')}>
                  <Umschalter an={settings.chatsDurchsuchen} setze={(wert) => void appStore.saveSettings({ chatsDurchsuchen: wert })} />
                </Zeile>
                <Zeile titel={t('settings.memory.sensitive')} text={t('settings.memory.sensitiveHint')}>
                  <Umschalter an={settings.gedaechtnisSensibel} setze={(wert) => void appStore.saveSettings({ gedaechtnisSensibel: wert })} />
                </Zeile>
              </Block>
              <Block titel={t('settings.memory.general')}>
                <p className="hinweis">{t('settings.memory.generalHint')}</p>
                <Erinnerungen t={t} />
              </Block>
            </>
          )}

          {abschnitt === 'data' && (
            <Block titel={t('settings.diagnostics')}>
              <Zeile titel={t('settings.data.platform')}>
                <code className="tasten">{window.desk.platform}</code>
              </Zeile>
              <Zeile titel={t('settings.data.keyring')}>
                {boot?.keychainAvailable ? (
                  <StatusPunkt ok label={t('settings.data.available')} />
                ) : (
                  <StatusPunkt label={t('settings.data.missing')} />
                )}
              </Zeile>
              <Zeile titel={t('settings.data.counts')}>
                <span className="wert">
                  {providers.length} · {models.length} · {chatAnzahl} · {projektAnzahl}
                </span>
              </Zeile>
              <div className="hinweis">{t('settings.data.hint')}</div>
            </Block>
          )}
          {abschnitt === 'data' && boot && (
            <Block titel={t('settings.about')}>
              <Zeile titel={boot.branding.name} text={boot.branding.copyright}>
                <a className="wert" href={boot.branding.webseite} target="_blank" rel="noopener noreferrer">
                  www.scalewise-ai.de
                </a>
              </Zeile>
              <Zeile titel={t('settings.about.source')}>
                <a className="wert" href={boot.branding.quellcode} target="_blank" rel="noopener noreferrer">
                  GitHub
                </a>
              </Zeile>
            </Block>
          )}
        </div>
      </div>
    </div>
  )
}

/** Eine Überschrift mit den Zeilen darunter. */
function Block({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <section className="einstellungen__block">
      <h3>{titel}</h3>
      {children}
    </section>
  )
}

/** Bezeichnung und Erklärung links, das Bedienelement rechts. */
function Zeile({ titel, text, children }: { titel: string; text?: string; children?: ReactNode }) {
  return (
    <div className="zeile">
      <div className="zeile__text">
        <div className="zeile__titel">{titel}</div>
        {text && <div className="zeile__erklarung">{text}</div>}
      </div>
      {children && <div className="zeile__steuerung">{children}</div>}
    </div>
  )
}

function Auswahl({ wert, optionen, setze }: { wert: string; optionen: Array<[string, string]>; setze: (wert: string) => void }) {
  return (
    <select className="input auswahl" value={wert} onChange={(e) => setze(e.target.value)}>
      {optionen.map(([wert, beschriftung]) => (
        <option key={wert} value={wert}>
          {beschriftung}
        </option>
      ))}
    </select>
  )
}

function Umschalter({ an, setze }: { an: boolean; setze: (wert: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={an} className="umschalter" data-an={an} onClick={() => setze(!an)}>
      <span className="umschalter__knopf" />
    </button>
  )
}

function StatusPunkt({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <span className={ok ? 'status status--ok' : 'status'}>
      {ok ? <IconCheck size={13} /> : <IconClose size={13} />} {label}
    </span>
  )
}

function ProviderEditor({
  provider,
  t,
  modelCount,
  testResult,
  onTested
}: {
  provider: ProviderConfig
  t: Translate
  modelCount: number
  testResult?: string
  onTested: (id: string, nachricht: string) => void
}) {
  const [schluessel, setSchluessel] = useState('')
  /**
   * Name und Adresse werden hier bearbeitet und erst beim Verlassen des Feldes
   * (oder mit Enter) gespeichert. Vorher ging jeder Tastendruck einzeln an die
   * Prüfung — „h" ist keine Adresse, also wurde zurückgesetzt, und die Adresse
   * ließ sich schlicht nicht ändern.
   */
  const [name, setName] = useState(provider.label)
  const [adresse, setAdresse] = useState(provider.baseUrl)
  const [hinweis, setHinweis] = useState<string | null>(null)
  useEffect(() => setName(provider.label), [provider.label])
  useEffect(() => setAdresse(provider.baseUrl), [provider.baseUrl])

  const uebernehmen = async (): Promise<void> => {
    const neueAdresse = adresse.trim()
    if (!/^https?:\/\/\S+$/i.test(neueAdresse)) {
      setHinweis(t('settings.urlInvalid'))
      return
    }
    setHinweis(null)
    const neuerName = name.trim() || provider.label
    const neuerSchluessel = schluessel.trim() ? schluessel.trim() : undefined
    if (neuerName === provider.label && neueAdresse === provider.baseUrl && neuerSchluessel === undefined) return
    await appStore.saveProvider({ ...provider, label: neuerName, baseUrl: neueAdresse }, neuerSchluessel)
    if (neuerSchluessel !== undefined) setSchluessel('')
  }
  const beiEnter = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') void uebernehmen()
  }

  return (
    <div className="anbieter">
      <div className="anbieter__kopf">
        <input
          className="input"
          style={{ flex: 1 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void uebernehmen()}
          onKeyDown={beiEnter}
        />
        <select
          className="input"
          value={provider.kind}
          onChange={(e) => void appStore.saveProvider({ ...provider, kind: e.target.value as ProviderConfig['kind'] })}
        >
          <option value="ollama">Ollama</option>
          <option value="llama">llama.cpp</option>
          <option value="openai">OpenAI-kompatibel</option>
        </select>
        <Umschalter an={provider.enabled} setze={(wert) => void appStore.saveProvider({ ...provider, enabled: wert })} />
      </div>
      <div className="anbieter__zeile">
        <input
          className="input"
          style={{ flex: 1 }}
          value={adresse}
          aria-invalid={hinweis ? true : undefined}
          onChange={(e) => setAdresse(e.target.value)}
          onBlur={() => void uebernehmen()}
          onKeyDown={beiEnter}
        />
        <input
          className="input"
          type="password"
          style={{ width: 160 }}
          placeholder={provider.hasKey ? t('settings.apiKeySet') : t('settings.apiKey')}
          value={schluessel}
          onChange={(e) => setSchluessel(e.target.value)}
          onBlur={() => void uebernehmen()}
          onKeyDown={beiEnter}
        />
      </div>
      {hinweis && <div className="hinweis" style={{ color: 'var(--warning)' }}>{hinweis}</div>}
      <div className="anbieter__fuss">
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const ergebnis = await window.desk.providers.test(provider.id)
            onTested(provider.id, ergebnis.message)
          }}
        >
          {t('settings.test')}
        </button>
        <button type="button" className="btn" data-variant="danger" onClick={() => void appStore.removeProvider(provider.id)}>
          <IconTrash size={13} /> {t('settings.remove')}
        </button>
        <span className="zahl">{testResult ?? `${modelCount} Modell(e)`}</span>
      </div>
    </div>
  )
}

/** Höchstens so viele Modelle stehen im Eingabefeld zur Wahl. */
const AUSWAHL_HOECHSTENS = 5

/**
 * Die Modelle fürs Eingabefeld: alle vorhandenen, mit Häkchen, höchstens fünf.
 * Genau die angehakten stehen dann im Modellmenü — wer vier wählt, hat vier.
 */
function ModellAuswahl({ t }: { t: Translate }) {
  const models = useApp((s) => s.models)
  const providers = useApp((s) => s.providers)
  const gewaehlt = useApp((s) => s.settings.modellauswahl) ?? []
  const [suche, setSuche] = useState('')
  const anbieter = (id: string): string => providers.find((p) => p.id === id)?.label ?? id
  const wort = suche.trim().toLowerCase()
  const gruppen = new Map<string, typeof models>()
  for (const model of models) {
    if (wort && !model.label.toLowerCase().includes(wort) && !anbieter(model.providerId).toLowerCase().includes(wort)) continue
    gruppen.set(model.providerId, [...(gruppen.get(model.providerId) ?? []), model])
  }
  const voll = gewaehlt.length >= AUSWAHL_HOECHSTENS

  const schalten = (ref: string): void => {
    const neu = gewaehlt.includes(ref) ? gewaehlt.filter((r) => r !== ref) : [...gewaehlt, ref].slice(0, AUSWAHL_HOECHSTENS)
    void appStore.saveSettings({ modellauswahl: neu })
  }

  return (
    <div className="modellwahl-liste">
      <Zeile titel={t('settings.modelPick')} text={t('settings.modelPickHint')}>
        <span className="zahl" data-voll={voll || undefined}>
          {t('settings.modelPickCount', { anzahl: String(gewaehlt.length), hoechstens: String(AUSWAHL_HOECHSTENS) })}
        </span>
      </Zeile>
      <input className="input" placeholder={t('models.search')} value={suche} onChange={(e) => setSuche(e.target.value)} />
      <div className="modellwahl-liste__alle">
        {[...gruppen.entries()].map(([id, liste]) => (
          <div key={id}>
            <div className="modellwahl-liste__gruppe">{anbieter(id)}</div>
            {liste.map((model) => {
              const ref = `${model.providerId}|${model.id}`
              const an = gewaehlt.includes(ref)
              return (
                <label key={ref} className="modellwahl-liste__eintrag" data-an={an || undefined} data-aus={!an && voll ? true : undefined}>
                  <input type="checkbox" checked={an} disabled={!an && voll} onChange={() => schalten(ref)} />
                  <span className="modellwahl-liste__name">{model.label}</span>
                  <span className="modellwahl-liste__art">
                    {[model.capabilities.thinking ? t('models.cap.thinking') : '', model.capabilities.tools ? t('models.cap.tools') : '', model.capabilities.vision ? t('models.cap.vision') : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </label>
              )
            })}
          </div>
        ))}
        {gruppen.size === 0 && <div className="hinweis">{t('models.noHit')}</div>}
      </div>
    </div>
  )
}
