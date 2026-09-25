import { useEffect, useRef, useState } from 'react'
import type { ChatMode, PermissionMode, } from '@shared/types'
import type { Translate } from '../i18n'
import { ModelPicker } from './ModelPicker'
import {
  IconAlert,
  IconCheck,
  IconCheckCircle,
  IconClose,
  IconFolder,
  IconHand,
  IconPaperclip,
  IconPlus,
  IconSendUp,
  IconStopSquare,
  IconGlobe,
  IconMic
} from './Icons'
import { readFilesAsAttachments } from '../lib/format'
import { appStore } from '../lib/store'
import { grundlos, wavAusSample } from '../lib/wav'

export interface ComposerSubmit {
  text: string
  images: { mediaType: string; dataBase64: string; name?: string }[]
  files: { name: string; mediaType: string; text: string }[]
  /** Tiefere Recherche eingeschaltet. */
  recherche?: boolean
}

interface Props {
  t: Translate
  mode: ChatMode
  onModeChange?: (mode: ChatMode) => void
  folder?: string
  onPickFolder?: () => void
  /**
   * Ein Grund, warum hier gerade nichts abzuschicken ist. Der Sendeknopf bleibt
   * dann aus, und der Satz darunter sagt, was fehlt — statt erst nach dem Klick
   * eine Fehlermeldung aus dem Hauptprozess anzusehen.
   */
  blocked?: string
  /** Zugriffsstufe dieses Chats; erscheint nur im Agent-Modus. */
  permissionMode?: PermissionMode
  onPermission?: (mode: PermissionMode) => void
  model?: string
  onModelSelect?: (reference: string) => void
  streaming?: boolean
  onStop?: () => void
  /** Während einer Antwort darf gesendet werden — die Nachricht wartet dann (Warteschlange). */
  kannEinreihen?: boolean
  /** Tiefere Recherche war in diesem Chat schon an. */
  rechercheStart?: boolean
  onSubmit: (payload: ComposerSubmit) => void
  placeholder?: string
  autoFocus?: boolean
}

interface Pending {
  images: { mediaType: string; dataBase64: string; name?: string }[]
  files: { name: string; mediaType: string; text: string }[]
}

export function Composer({
  t,
  mode,
  onModeChange,
  onPickFolder,
  blocked,
  permissionMode,
  onPermission,
  model,
  onModelSelect,
  streaming,
  kannEinreihen,
  rechercheStart,
  onStop,
  onSubmit,
  placeholder,
  autoFocus
}: Props) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState<Pending>({ images: [], files: [] })
  /** Wie viele Anhänge gerade gelesen werden (PDF, Word). */
  const [liest, setLiest] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  // Tiefere Recherche: bleibt für diesen Chat an, bis man sie ausschaltet.
  const [recherche, setRecherche] = useState(Boolean(rechercheStart))
  const [permissionOpen, setPermissionOpen] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  // Das Diktat: Aufnahme, Rückmeldung, und was das Gerät überhaupt kann.
  const [aufnahme, setAufnahme] = useState(false)
  const [diktat, setDiktat] = useState<{ bereit: boolean; hinweis: string } | null>(null)
  const [diktatMeldung, setDiktatMeldung] = useState('')
  const tonRef = useRef<{ stopp: () => Promise<void>; abbrechen: () => void } | null>(null)
  // Beim Verlassen (anderer Chat, Senden wechselt die Ansicht) das Mikrofon
  // freigeben — sonst nahm es ohne sichtbaren Stop-Knopf endlos weiter auf.
  useEffect(() => () => tonRef.current?.abbrechen(), [])

  useEffect(() => {
    void (async () => {
      try {
        const stand = await window.desk.diktat.stand()
        setDiktat({ bereit: stand.bereit, hinweis: stand.hinweis })
      } catch {
        setDiktat({ bereit: false, hinweis: 'Die Diktat-Einrichtung ist nicht erreichbar.' })
      }
    })()
  }, [])

  async function diktatSchalten(): Promise<void> {
    if (aufnahme) {
      await tonRef.current?.stopp()
      return
    }
    if (!diktat?.bereit) {
      setDiktatMeldung(diktat?.hinweis || 'Diktat ist nicht eingerichtet.')
      return
    }
    setDiktatMeldung('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const kontext = new AudioContext()
      const quelle = kontext.createMediaStreamSource(stream)
      const brocken: Float32Array[] = []
      const puffer = kontext.createScriptProcessor(4096, 1, 1)
      puffer.onaudioprocess = (ereignis) => brocken.push(new Float32Array(ereignis.inputBuffer.getChannelData(0)))
      quelle.connect(puffer)
      puffer.connect(kontext.destination)
      setAufnahme(true)
      tonRef.current = {
        abbrechen: () => {
          puffer.disconnect()
          quelle.disconnect()
          stream.getTracks().forEach((spur) => spur.stop())
          void kontext.close().catch(() => undefined)
          tonRef.current = null
        },
        stopp: async () => {
          setAufnahme(false)
          puffer.disconnect()
          quelle.disconnect()
          stream.getTracks().forEach((spur) => spur.stop())
          const zusammen = new Float32Array(brocken.reduce((summe, e) => summe + e.length, 0))
          let stelle = 0
          for (const e of brocken) {
            zusammen.set(e, stelle)
            stelle += e.length
          }
          await kontext.close()
          if (zusammen.length < kontext.sampleRate / 2) {
            setDiktatMeldung('Zu kurz — einmal in Ruhe sprechen.')
            return
          }
          setDiktatMeldung('Ich schreibe es auf …')
          try {
            const antwort = await window.desk.diktat.schreiben(await grundlos(wavAusSample([zusammen], kontext.sampleRate)))
            if ('error' in antwort) setDiktatMeldung(antwort.error)
            else {
              const vorher = areaRef.current?.value.trim() ?? ''
              setText(antwort.text + (vorher ? `\n${vorher}` : ''))
              setDiktatMeldung('')
              areaRef.current?.focus()
            }
          } catch (fehler) {
            setDiktatMeldung(fehler instanceof Error ? fehler.message : String(fehler))
          }
        }
      }
    } catch {
      setAufnahme(false)
      setDiktatMeldung('Das Mikrofon hat nicht geantwortet.')
    }
  }
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const permissionRef = useRef<HTMLDivElement>(null)

  // Klick außerhalb und Escape schließen die Zugriffsliste.
  useEffect(() => {
    if (!permissionOpen) return
    const onPointer = (event: MouseEvent): void => {
      if (!permissionRef.current?.contains(event.target as Node)) setPermissionOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPermissionOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [permissionOpen])

  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    area.style.height = '0px'
    area.style.height = `${Math.min(area.scrollHeight, 280)}px`
  }, [text])

  useEffect(() => {
    if (autoFocus) areaRef.current?.focus()
  }, [autoFocus])

  // Antwort fertig → Schreibmarke zurück ins Eingabefeld, damit man gleich
  // weiterschreiben kann. Nicht, wenn man gerade anderswo tippt (Nachricht
  // bearbeiten, Einstellungen) oder am Handy — dort spränge die Tastatur auf.
  const liefVorher = useRef(Boolean(streaming))
  useEffect(() => {
    const warLaufend = liefVorher.current
    liefVorher.current = Boolean(streaming)
    if (!warLaufend || streaming) return
    if (window.matchMedia?.('(hover: none)').matches) return
    if (document.querySelector('.overlay')) return
    const aktiv = document.activeElement
    if (aktiv && aktiv !== document.body && aktiv !== areaRef.current && aktiv.matches('input, textarea, select, [contenteditable="true"]')) return
    areaRef.current?.focus()
  }, [streaming])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const hatInhalt = text.trim().length > 0 || pending.images.length > 0 || pending.files.length > 0
  const canSend = hatInhalt && !blocked && (!streaming || Boolean(kannEinreihen))
  // Läuft eine Antwort und steht etwas im Feld: der Knopf reiht ein, statt zu stoppen.
  const stoppKnopf = Boolean(streaming) && !(kannEinreihen && hatInhalt)

  const submit = (): void => {
    if (!canSend) return
    onSubmit({ text: text.trim(), images: pending.images, files: pending.files, recherche: recherche || undefined })
    setText('')
    setPending({ images: [], files: [] })
  }

  /** Ein Weg für alle: Auswählen, Einfügen (Strg+V) und Hineinziehen. */
  const hinzufuegen = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    setLiest((n) => n + files.length)
    try {
      const result = await readFilesAsAttachments(files)
      setPending((prev) => ({ images: [...prev.images, ...result.images], files: [...prev.files, ...result.texts] }))
      if (result.fehler.length) appStore.setError(result.fehler.join(' '))
    } finally {
      setLiest((n) => n - files.length)
    }
  }

  const pickFiles = async (): Promise<void> => {
    const input = inputRef.current
    if (!input) return
    const files = Array.from(input.files ?? [])
    input.value = ''
    setMenuOpen(false)
    await hinzufuegen(files)
  }

  // Dateien ins Fenster ziehen — irgendwohin. Es gibt immer nur
  // ein Eingabefeld auf dem Schirm; das nimmt sie auf.
  const [ziehen, setZiehen] = useState(false)
  const hinzufuegenRef = useRef(hinzufuegen)
  hinzufuegenRef.current = hinzufuegen
  useEffect(() => {
    const mitDateien = (e: DragEvent): boolean => Boolean(e.dataTransfer?.types.includes('Files'))
    // Ist ein Dialog offen (Einstellungen, Artifact), gehört das Ziehen ihm —
    // sonst landete die Datei unsichtbar im Eingabefeld dahinter.
    const dialogOffen = (): boolean => Boolean(document.querySelector('.overlay'))
    const ueber = (e: DragEvent): void => {
      if (!mitDateien(e) || dialogOffen()) return
      e.preventDefault()
      setZiehen(true)
    }
    const weg = (e: DragEvent): void => {
      // relatedTarget null heißt: der Zeiger hat das Fenster verlassen.
      if (!e.relatedTarget) setZiehen(false)
    }
    const fallen = (e: DragEvent): void => {
      if (!mitDateien(e) || dialogOffen()) return
      e.preventDefault()
      setZiehen(false)
      void hinzufuegenRef.current(Array.from(e.dataTransfer?.files ?? []))
    }
    window.addEventListener('dragover', ueber)
    window.addEventListener('dragleave', weg)
    window.addEventListener('drop', fallen)
    return () => {
      window.removeEventListener('dragover', ueber)
      window.removeEventListener('dragleave', weg)
      window.removeEventListener('drop', fallen)
    }
  }, [])

  return (
    <div className="composer" data-ziehen={ziehen || undefined}>
      {ziehen && <div className="composer__ablage">{t('composer.dropHere')}</div>}
      <textarea
        ref={areaRef}
        className="composer__input"
        rows={1}
        value={text}
        placeholder={placeholder ?? t('home.placeholder')}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          // Bilder und Dateien aus der Zwischenablage (Bildschirmfoto, kopierte
          // Datei) werden Anhänge; reiner Text fügt sich wie immer ein.
          const dateien = Array.from(e.clipboardData.files)
          if (dateien.length === 0) return
          // Word, Excel und LibreOffice legen zum Text ein Bild dazu — dann ist
          // der Text gemeint. Nur reine Bilder und Dateien werden Anhänge.
          if (e.clipboardData.getData('text/plain').trim() && dateien.every((d) => d.type.startsWith('image/'))) return
          e.preventDefault()
          void hinzufuegen(dateien)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
          if (e.key === 'Escape' && streaming) onStop?.()
        }}
      />

      {(pending.images.length > 0 || pending.files.length > 0 || liest > 0 || recherche) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {recherche && (
            <span className="composer__schalter" title={t('composer.researchOn')}>
              <IconGlobe size={13} /> {t('composer.research')}
              <button type="button" aria-label={t('composer.researchOff')} title={t('composer.researchOff')} onClick={() => setRecherche(false)}>
                ×
              </button>
            </span>
          )}
          {liest > 0 && <span className="composer__liest">{t('composer.reading')}</span>}
          {pending.images.map((image, index) => (
            <Attachment
              key={`img-${index}`}
              t={t}
              label={image.name ?? t('composer.unnamedImage')}
              preview={`data:${image.mediaType};base64,${image.dataBase64}`}
              onRemove={() =>
                setPending((prev) => ({ ...prev, images: prev.images.filter((_, i) => i !== index) }))
              }
            />
          ))}
          {pending.files.map((file, index) => (
            <Attachment
              key={`file-${index}`}
              t={t}
              label={file.name}
              onRemove={() => setPending((prev) => ({ ...prev, files: prev.files.filter((_, i) => i !== index) }))}
            />
          ))}
        </div>
      )}

      {blocked && (
        <div className="composer__blocked" role="status">
          {blocked}
        </div>
      )}

      {diktatMeldung && <span className="diktat-meldung">{diktatMeldung}</span>}
      <div className="composer__bar">
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="icon-btn"
            title={t('home.addFiles')}
            aria-label={t('home.addFiles')}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <IconPlus />
          </button>
          {menuOpen && (
            <div role="menu" className="composer-menu" aria-label={t('home.addFiles')}>
              <MenuItem
                icon={<IconPaperclip size={15} />}
                label={t('home.addFiles')}
                onClick={() => {
                  inputRef.current?.click()
                }}
              />
              <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
              <MenuItem
                icon={<IconFolder size={15} />}
                label={mode === 'agent' ? t('home.workInFolderChange') : t('home.workInFolder')}
                disabled={!onPickFolder}
                onClick={() => {
                  onPickFolder?.()
                  setMenuOpen(false)
                }}
              />
              <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
              <MenuItem
                icon={<IconGlobe size={15} />}
                label={t('composer.research')}
                selected={recherche}
                onClick={() => {
                  // Ein Schalter, kein Textbaustein: das Eingabefeld bleibt, wie es ist.
                  setRecherche((an) => !an)
                  setMenuOpen(false)
                  requestAnimationFrame(() => areaRef.current?.focus())
                }}
              />
            </div>
          )}
        </div>

        {onModeChange && (
          <div className="segmented" role="radiogroup" aria-label={t('home.mode.chat')}>
            {(['chat', 'agent'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                data-active={mode === value}
                onClick={() => onModeChange(value)}
              >
                {t(`home.mode.${value}`)}
              </button>
            ))}
          </div>
        )}

        {mode === 'agent' && onPermission && (
          <div ref={permissionRef} className="freigabewahl" style={{ position: 'relative' }}>
            <button
              type="button"
              className="permission-trigger"
              data-level={permissionMode ?? 'ask'}
              aria-haspopup="menu"
              aria-expanded={permissionOpen}
              title={t('permission.hint')}
              onClick={() => setPermissionOpen((v) => !v)}
            >
              {permissionMode === 'everything' ? (
                <IconAlert />
              ) : permissionMode === 'autoWrites' ? (
                <IconCheckCircle />
              ) : (
                <IconHand />
              )}
              <span>{t(`permission.${permissionMode ?? 'ask'}.short`)}</span>
            </button>
            {permissionOpen && (
              <div role="menu" className="composer-menu composer-menu--wide" aria-label={t('permission.title')}>
                {(['ask', 'autoWrites', 'everything'] as const).map((value) => (
                  <MenuItem
                    key={value}
                    icon={
                      value === 'everything' ? (
                        <IconAlert size={15} />
                      ) : value === 'autoWrites' ? (
                        <IconCheckCircle size={15} />
                      ) : (
                        <IconHand size={15} />
                      )
                    }
                    label={t(`permission.${value}`)}
                    hint={t(`permission.${value}.note`)}
                    selected={(permissionMode ?? 'ask') === value}
                    onClick={() => {
                      onPermission(value)
                      setPermissionOpen(false)
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="composer__spacer" />

        {onModelSelect && (
          <ModelPicker value={model} onSelect={onModelSelect} t={t} />
        )}

        {/* Das Mikrofon gehört rechts neben die Modellauswahl: greifnah, und
            dort, wo es auch im Vorbild sitzt. Im Browser nur über eine sichere
            Verbindung — über http gibt der Browser das Mikrofon nicht frei. */}
        {(!window.desk.fern || window.isSecureContext) && (
        <button
          type="button"
          className={aufnahme ? 'icon-btn mic-btn icon-btn--rec' : 'icon-btn mic-btn'}
          title={aufnahme ? t('composer.micStop') : diktat?.bereit ? t('composer.mic') : diktat?.hinweis || t('composer.micCheck')}
          aria-label={aufnahme ? t('composer.micStop') : t('composer.mic')}
          aria-pressed={aufnahme}
          onClick={() => void diktatSchalten()}
        >
          <IconMic />
        </button>
        )}

        <button
          type="button"
          className="send"
          data-stop={stoppKnopf ? 'true' : 'false'}
          disabled={!stoppKnopf && (!canSend || Boolean(blocked))}
          title={stoppKnopf ? t('home.stop') : streaming ? t('composer.queue') : t('home.send')}
          aria-label={stoppKnopf ? t('home.stop') : streaming ? t('composer.queue') : t('home.send')}
          onClick={() => (stoppKnopf ? onStop?.() : submit())}
        >
          {stoppKnopf ? <IconStopSquare size={15} /> : <IconSendUp size={16} />}
        </button>
      </div>

      <input ref={inputRef} type="file" multiple className="visually-hidden" onChange={() => void pickFiles()} />
    </div>
  )
}

function MenuItem({
  icon,
  label,
  hint,
  selected,
  onClick,
  disabled
}: {
  icon: React.ReactNode
  label: string
  /** Kleine zweite Zeile; die Zugriffsstufen erklären sich darin selbst. */
  hint?: string
  selected?: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-checked={selected}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: hint ? 'flex-start' : 'center',
        gap: 10,
        width: '100%',
        textAlign: 'left',
        padding: '7px 8px',
        borderRadius: 'var(--radius-sm)',
        color: disabled ? 'var(--text-faint)' : 'var(--text)'
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ flex: '0 0 auto', marginTop: hint ? 1 : 0 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block' }}>{label}</span>
        {hint && (
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.35 }}>
            {hint}
          </span>
        )}
      </span>
      {selected && (
        <span style={{ flex: '0 0 auto', color: 'var(--accent)', marginTop: hint ? 1 : 0 }}>
          <IconCheck size={14} />
        </span>
      )}
    </button>
  )
}

function Attachment({ label, preview, onRemove, t }: { label: string; preview?: string; onRemove: () => void; t: Translate }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 8px 3px 4px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-pill)',
        background: 'var(--surface-raised)',
        fontSize: 12,
        maxWidth: 220
      }}
    >
      {preview ? (
        <img src={preview} alt="" style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover' }} />
      ) : (
        <IconPaperclip size={13} />
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <button type="button" className="icon-btn" style={{ width: 18, height: 18 }} onClick={onRemove} aria-label={t('composer.remove')}>
        <IconClose size={12} />
      </button>
    </span>
  )
}
