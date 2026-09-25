/**
 * Vorschau-Panel rechts. Ein Slot wie in der Vorlage: die angeklickte Datei
 * erscheint hier — Markdown gerendert, PDF im eingebauten Betrachter, Word
 * seitenähnlich, Bilder direkt. Änderungen auf der Platte laden neu.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import type { PreviewPayload } from '@shared/types'
import type { Translate } from '../../i18n'
import { appStore, useApp } from '../../lib/store'
import { Markdown } from '../../components/Markdown'
import { IconClose, IconDownload, IconExpand, IconExternal, IconFolder } from '../../components/Icons'
import { PdfPages } from './PdfPages'
import { baseName } from '../../lib/format'

/**
 * Die Breite, die aus dem Zeiger folgt: was war, plus der Weg nach links.
 *
 * Eigens als eigene Funktion — die alte Rechnung mischte einen Bildschirmwert
 * mit einer Breite, und das Ergebnis war ein Sprung ans Ende der Skala statt
 * eines sanften Ziehens. So ist sie prüfbar, ohne einen Zeiger vorzuspielen.
 */
/** So viel Breite bleibt dem Gespräch neben der Vorschau mindestens (wie im CSS). */
const GESPRAECH_MINDESTENS = 360

export function breiteAusZeiger(anfang: number, von: number, jetzt: number): number {
  return anfang + (von - jetzt)
}

export function DocumentPanel({ t }: { t: Translate }) {
  const target = useApp((s) => s.panel)
  const width = useApp((s) => s.settings.panelWidth)
  const path = target?.path
  const stand = target?.stand ?? 0
  const [payload, setPayload] = useState<PreviewPayload | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [reload, setReload] = useState(0)
  // Ausgebreitet nimmt die Vorschau die ganze Breite ein; die Breite in den
  // Einstellungen bleibt unverändert und gilt wieder nach dem Einengen.
  const [wide, setWide] = useState(false)

  useEffect(() => {
    if (!path) {
      setPayload(null)
      return
    }
    let alive = true
    setError(undefined)
    void window.desk.documents
      .preview(path)
      .then((result) => {
        if (alive) setPayload(result)
      })
      .catch((e: unknown) => {
        if (alive) setError((e as Error).message)
      })
    return () => {
      alive = false
    }
  }, [path, reload, stand])

  // Änderungen an der offenen Datei nachziehen (in main gedrosselt).
  useEffect(() => {
    if (!path) return
    return window.desk.documents.onChanged((event) => {
      if (event.path === path) setReload((n) => n + 1)
    })
  }, [path])

  useEffect(() => {
    if (!path) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') appStore.closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [path])

  /**
   * Mit der Maus an der Breite ziehen. Drei Dinge machen den Unterschied
   * zwischen „geht" und „fühlt sich an wie ein Fenster":
   * 1. Die Breite läuft mit, ohne zu speichern — geschrieben wird erst loslassen.
   * 2. Am Körper steht `is-resizing`, damit der Cursor nicht flackert und keine
   *    Textmarkierung losläuft, wenn die Maus über den Blattstapel gerät.
   * 3. Der Zeiger bleibt auch erhalten, wenn er über Knöpfe und Blätter wandert.
   */
  const startDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const grip = event.currentTarget
    // Der Fang ist ein Vorteil, keine Bedingung: ohne echte Zeiger (Teststeuerung,
    // weggelaufener Zeiger) schlägt er fehl, und das Ziehen darf trotzdem anfangen.
    try {
      grip.setPointerCapture(event.pointerId)
    } catch {
      /* nicht gefangen — die Fensterereignisse unten reichen auch */
    }
    document.body.classList.add('is-resizing')
    // Gezählt wird der Weg des Zeigers, nicht seine Lage: die Breite beim Anpacken
    // plus das, was der Zeiger nach links oder rechts gewandert ist. Aus der
    // Lage allein wurde sonst ein Sprung — die Formengrenze war von einem
    // Bildschirmwert und einer Breite gemischt.
    // Angefangen wird bei der Breite, die zu sehen ist — nicht bei der gemerkten,
    // die größer sein kann, als das Fenster hergibt. Sonst gibt es eine tote
    // Strecke, bis der Zeiger die Lücke aufgeholt hat.
    const aside = grip.parentElement
    const anfang = aside?.getBoundingClientRect().width ?? width
    const von = event.clientX
    const platz = aside?.parentElement?.getBoundingClientRect().width ?? Infinity
    const hoechstens = Math.max(320, platz - GESPRAECH_MINDESTENS)

    const move = (moveEvent: PointerEvent): void => {
      appStore.setPanelWidth(Math.min(breiteAusZeiger(anfang, von, moveEvent.clientX), hoechstens), false)
    }
    const stop = (): void => {
      appStore.commitPanelWidth(grip.parentElement?.getBoundingClientRect().width)
      document.body.classList.remove('is-resizing')
      try {
        if (grip.hasPointerCapture?.(event.pointerId)) grip.releasePointerCapture(event.pointerId)
      } catch {
        /* der Fang bestand ohnehin nicht */
      }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  if (!target) return null

  return (
    <aside className={wide ? 'doc-panel doc-panel--wide' : 'doc-panel'} style={wide ? undefined : { width }} aria-label={target.title}>
      <div className="doc-panel__grip" onPointerDown={startDrag} title={t('panel.resize')} />

      <header className="doc-panel__head">
        <div className="doc-panel__names">
          <div className="doc-panel__title" title={target.path}>
            {baseName(target.path)}
          </div>
          <div className="doc-panel__path">{target.path}</div>
        </div>
        <div className="doc-panel__actions">
          {(payload?.kind === 'markdown' || payload?.kind === 'text') && <SourceToggle />}
          <button type="button" className="icon-btn" onClick={() => void window.desk.documents.reveal(target.path)} title={t('docs.reveal')}>
            <IconFolder size={15} />
          </button>
          <button type="button" className="icon-btn" onClick={() => void window.desk.documents.open(target.path)} title={t('docs.openExternal')}>
            <IconExternal size={15} />
          </button>
          <button type="button" className="icon-btn" onClick={() => void window.desk.documents.saveAs(target.path)} title={t('docs.saveAs')}>
            <IconDownload size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setWide((current) => !current)}
            title={wide ? t('panel.collapse') : t('panel.expand')}
            aria-pressed={wide}
          >
            <IconExpand size={15} />
          </button>
          <button type="button" className="icon-btn" onClick={() => appStore.closePanel()} aria-label={t('docs.close')}>
            <IconClose size={15} />
          </button>
        </div>
      </header>

      <div className="doc-panel__body">
        {error && <div className="doc-panel__notice">{error}</div>}
        {!payload && !error && <div className="doc-panel__hint">{t('panel.loading')}</div>}
        {payload && <Preview payload={payload} t={t} />}
      </div>
    </aside>
  )
}

function SourceToggle() {
  const sourceView = useApp((s) => s.settings.panelSourceView)
  return (
    <button type="button" className="icon-btn" onClick={() => appStore.togglePanelSource()} title={sourceView ? 'Gerendert' : 'Quelltext'}>
      <span style={{ fontSize: 10, fontWeight: 700 }}>{sourceView ? 'MD' : '&lt;/&gt;'}</span>
    </button>
  )
}

/**
 * Der PDF-Zweig füllt das Feld und rollt **selbst** (Papierstapel mit eigener
 * Scrollstrecke). Alles andere ist eine Seite: die atmet unten Luft und rollt.
 */
function Preview({ payload, t }: { payload: PreviewPayload; t: Translate }) {
  switch (payload.kind) {
    case 'markdown':
      return <div className="doc-panel__seite"><MarkdownView payload={payload} /></div>
    case 'text':
      return <div className="doc-panel__seite"><CodeBlock text={payload.text} truncated={payload.truncated} /></div>
    case 'image':
      return <div className="doc-panel__seite"><ImageView payload={payload} /></div>
    case 'pdf':
      return <PdfPages base64={payload.base64} path={payload.path} t={t} />
    case 'docx':
      return <div className="doc-panel__seite"><WordView payload={payload} /></div>
    case 'unsupported':
      return (
        <div className="doc-panel__seite doc-panel__notice">
          {payload.reason}
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn" onClick={() => void window.desk.documents.open(payload.path)}>
              {t('docs.openExternal')}
            </button>
          </div>
        </div>
      )
  }
}

function MarkdownView({ payload }: { payload: Extract<PreviewPayload, { kind: 'markdown' }> }) {
  const sourceView = useApp((s) => s.settings.panelSourceView)
  if (sourceView) return <CodeBlock text={payload.text} truncated={payload.truncated} />
  return <Markdown text={payload.text} />
}

function CodeBlock({ text, truncated }: { text: string; truncated: boolean }) {
  return (
    <>
      <pre className="doc-panel__code">{text}</pre>
      {truncated && <div className="doc-panel__hint">…gekürzt</div>}
    </>
  )
}

function ImageView({ payload }: { payload: Extract<PreviewPayload, { kind: 'image' }> }) {
  const url = useBlobUrl(payload.base64, payload.mediaType)
  return <img className="doc-panel__image" src={url} alt={baseName(payload.path)} />
}

/** Word seitenähnlich; docx-preview baut das Dokument in ein eigenes Element. */
function WordView({ payload }: { payload: Extract<PreviewPayload, { kind: 'docx' }> }) {
  const host = useRef<HTMLDivElement | null>(null)
  const data = useMemo<Blob | null>(() => {
    try {
      return new Blob([bytesFrom(payload.base64)], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      })
    } catch {
      return null
    }
  }, [payload.base64])

  useEffect(() => {
    const node = host.current
    if (!node || !data) return
    node.innerHTML = ''
    void renderAsync(data, node, node, {
      inWrapper: true,
      breakPages: true,
      // Seitenmaß ignorieren: die A4-Breite wäre breiter als das Panel.
      ignoreWidth: true,
      ignoreHeight: true,
      ignoreFonts: false,
      renderHeaders: false,
      renderFooters: false,
      experimental: false
    })
  }, [data])

  return <div ref={host} className="doc-panel__word" />
}

/** Base64 → Bytepuffer mit festem ArrayBuffer (Blob erwartet keinen SharedArrayBuffer-Typ). */
function bytesFrom(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function useBlobUrl(base64: string, mediaType: string): string {
  return useMemo(() => URL.createObjectURL(new Blob([bytesFrom(base64)], { type: mediaType })), [base64, mediaType])
}
