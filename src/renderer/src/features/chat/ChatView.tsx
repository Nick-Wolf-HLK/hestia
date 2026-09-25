import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMode, Message, MessageMetrics } from '@shared/types'
import type { Translate } from '../../i18n'
import { appStore, sucheJeChat, useApp, type Eingereiht } from '../../lib/store'
import { Composer, type ComposerSubmit } from '../../components/Composer'
import { DocumentPanel } from './DocumentPanel'
import { startModell } from '@shared/startmodell'
import type { DocumentKind } from '@shared/types'
import { formatBytes, formatDuration, formatRate } from '../../lib/format'
import { Markdown } from '../../components/Markdown'
import { IconBack, IconCheck, IconChevronDown, IconCopy, IconFile, IconFolder, IconForward, IconGauge, IconPencil, IconRetry, IconSpark, LogoMark } from '../../components/Icons'
import { baseName } from '../../lib/format'
import { buildTimeline, stepDetail, stepKey, summarize, type ToolStep } from '../../lib/timeline'

/** Einzelner Lauf: Nachrichtenliste oben, Composer unten. */
const EMPTY_MESSAGES: import('@shared/types').Message[] = []
const EMPTY_QUEUE: Eingereiht[] = []

export function ChatView({ t }: { t: Translate }) {
  const activeChatId = useApp((s) => s.activeChatId)
  const chat = useApp((s) => s.chats.find((c) => c.id === s.activeChatId))
  // Konstante leere Liste: ein neues [] pro Aufruf würde den Snapshot kippen.
  const messages = useApp((s) => (s.activeChatId ? s.messages[s.activeChatId] : undefined) ?? EMPTY_MESSAGES)
  const settings = useApp((s) => s.settings)
  const streamingByChat = useApp((s) => s.streamingByChat)
  const warteschlange = useApp((s) => s.warteschlange)
  const wartend = (activeChatId ? warteschlange[activeChatId] : undefined) ?? EMPTY_QUEUE
  const allPermissions = useApp((s) => s.permissions)
  // Abgeleitet statt im Selektor gefiltert: sonst ändert sich der Snapshot ständig.
  const pendingPermissions = useMemo(
    () => allPermissions.filter((entry) => entry.chatId === activeChatId),
    [allPermissions, activeChatId]
  )

  const [model, setModel] = useState<string | undefined>(chat?.model ?? startModell(settings, chat?.mode))
  const bottom = useRef<HTMLDivElement>(null)

  // Modell des Chats oder globaler Standard; als Wert, damit der Hook prüfbar bleibt.
  const effectiveModel = chat?.model ?? startModell(settings, chat?.mode)

  useEffect(() => {
    setModel(effectiveModel)
  }, [chat?.id, effectiveModel])

  // Abhängigkeit als einfacher Wert, damit React sie prüfen kann. Die Länge
  // zählt mit, nicht nur die Zahl der Teile: sonst wächst eine Antwort unten
  // aus dem Bild, und das mitlaufende Zeichen mit ihr.
  const letzte = messages.length > 0 ? messages[messages.length - 1]! : undefined
  const lastPartCount = letzte?.parts.length ?? 0
  const lastLength = letzte ? letzte.parts.reduce((summe, teil) => summe + ('text' in teil ? teil.text.length : 0), 0) : 0
  const amEnde = useRef(true)

  useEffect(() => {
    const rolle = bottom.current?.closest('.main__scroll')
    if (!rolle) return
    // Wer hochgescrollt hat, liest — den reißt der Lauf nicht zurück.
    const merken = (): void => {
      amEnde.current = rolle.scrollHeight - rolle.scrollTop - rolle.clientHeight < 80
    }
    rolle.addEventListener('scroll', merken, { passive: true })
    return () => rolle.removeEventListener('scroll', merken)
  }, [])

  useEffect(() => {
    amEnde.current = true
  }, [activeChatId, messages.length])


  const streaming = Boolean(activeChatId && streamingByChat[activeChatId])

  // Nach dem Lauf erscheinen Knöpfe und Durchsatz unter der Antwort — auch die
  // sollen im Bild landen, darum zählt das Ende des Laufs mit.
  useEffect(() => {
    if (!amEnde.current) return
    bottom.current?.scrollIntoView({ behavior: lastLength > 0 && lastPartCount > 0 ? 'auto' : 'smooth', block: 'end' })
  }, [lastPartCount, lastLength, messages.length, streaming])

  const submit = async (payload: ComposerSubmit): Promise<void> => {
    if (!activeChatId) return
    const nachricht = { text: payload.text, images: payload.images, files: payload.files, model, suche: payload.suche }
    // Läuft gerade eine Antwort: einreihen statt abweisen — geht danach von allein raus.
    if (streaming || wartend.length > 0) {
      appStore.einreihen(activeChatId, nachricht)
      return
    }
    await appStore.sendMessage({ chatId: activeChatId, ...nachricht })
  }

  const setMode = async (next: ChatMode): Promise<void> => {
    if (!activeChatId) return
    await appStore.setChatMode(activeChatId, next)
  }

  const pickFolder = async (): Promise<void> => {
    if (!activeChatId) return
    const picked = await window.desk.dialogs.pickFolder(chat?.folder)
    if (picked) await appStore.setChatMode(activeChatId, 'agent', picked)
  }

  return (
    <div className="chat-layout">
      <div className="chat-layout__main">
      <div className="main__scroll">
        <div className="pane">
          {messages.length === 0 && (
            <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '8px 0 4px' }}>{t('chat.empty')}</div>
          )}
          <div className="messages">
            {messages.map((message, index) => (
              <MessageBlock
                key={message.id}
                message={message}
                t={t}
                model={model}
                streaming={streaming}
                live={streaming && index === messages.length - 1}
                juengste={index === messages.length - 1}
                wartet={index === messages.length - 1 && pendingPermissions.length > 0}
              />
            ))}
            <div ref={bottom} />
          </div>
        </div>
      </div>

      <div className="chat-fuss">
        <div style={{ width: 'min(760px, 100%)' }}>
          {chat?.mode === 'agent' && (
            <div className="agent-strip" style={{ marginTop: 0, marginBottom: 8 }}>
              <button type="button" className="folder-chip" data-set={chat.folder ? 'true' : 'false'} onClick={() => void pickFolder()}>
                <IconFolder size={14} />
                {chat.folder ? baseName(chat.folder) : t('home.workInFolder')}
              </button>
            </div>
          )}
          {pendingPermissions.map((request) => (
            <PermissionCard key={request.id} request={request} t={t} />
          ))}
          {wartend.length > 0 && (
            <ol className="warteschlange" aria-label={t('composer.queued')}>
              {wartend.map((eintrag) => (
                <li key={eintrag.id} className="warteschlange__eintrag" title={t('composer.queuedHint')}>
                  <span className="warteschlange__marke">{t('composer.queued')}</span>
                  <span className="warteschlange__text">{eintrag.text || eintrag.files?.[0]?.name || eintrag.images?.[0]?.name || '…'}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('composer.queuedRemove')}
                    title={t('composer.queuedRemove')}
                    onClick={() => activeChatId && appStore.ausReihe(activeChatId, eintrag.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          )}
          <Composer
            // Je Chat ein eigenes Eingabefeld: Entwurf und Anhänge aus Chat A
            // gingen sonst beim Wechsel mit nach B und wurden dort gesendet.
            key={activeChatId}
            t={t}
            mode={chat?.mode ?? 'chat'}
            onModeChange={(next) => void setMode(next)}
            blocked={chat?.mode === 'agent' && !chat.folder ? t('home.needsFolder') : undefined}
            permissionMode={chat?.permissionMode}
            onPermission={(next) => {
              if (activeChatId) void appStore.setChatPermission(activeChatId, next)
            }}
            model={model}
            onModelSelect={(reference) => {
              setModel(reference)
              if (activeChatId) void appStore.setChatModel(activeChatId, reference)
            }}
            streaming={streaming}
            kannEinreihen
            sucheStart={activeChatId ? sucheJeChat.get(activeChatId) : undefined}
            onStop={() => {
              if (activeChatId) void appStore.stopStream(activeChatId)
            }}
            onSubmit={(payload) => void submit(payload)}
          />
        </div>
      </div>
      </div>

      <DocumentPanel t={t} />
    </div>
  )
}

function PermissionCard({ request, t }: { request: import('@shared/types').PermissionRequest; t: Translate }) {
  const [remember, setRemember] = useState(false)
  return (
    <div
      style={{
        border: '1px solid var(--warning)',
        background: 'var(--warning-soft)',
        borderRadius: 'var(--radius-md)',
        padding: '10px 12px',
        marginBottom: 10
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span className="dot" data-tone="warning" />
        <strong style={{ fontSize: 13.5 }}>
          {request.kind === 'command' ? t('permission.command') : t('permission.write')}
        </strong>
        <code style={{ marginLeft: 'auto', fontSize: 12 }}>{request.target}</code>
      </div>
      <pre
        style={{
          margin: '0 0 8px',
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          whiteSpace: 'pre-wrap',
          maxHeight: 140,
          overflowY: 'auto',
          userSelect: 'text'
        }}
      >
        {request.detail}
      </pre>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)' }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {t('permission.remember')}
        </label>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={() => void appStore.answerPermission(request.id, false)}>
          {t('action.deny')}
        </button>
        <button
          type="button"
          className="btn"
          data-variant="primary"
          onClick={() => void appStore.answerPermission(request.id, true, remember)}
        >
          {t('action.allow')}
        </button>
      </div>
    </div>
  )
}

function MessageBlock({
  message,
  t,
  model,
  streaming,
  live = false,
  juengste = false,
  wartet = false
}: {
  message: Message
  t: Translate
  /** Das im Eingabefeld gewählte Modell — damit antworten Bearbeiten und Wiederholen. */
  model?: string
  streaming: boolean
  /** Die neueste Antwort im Gespräch — nur unter ihr steht das Zeichen. */
  juengste?: boolean
  /** Eine Freigabe für diesen Chat ist offen: der Lauf steht, er denkt nicht. */
  wartet?: boolean
  /** Wahr nur bei der Antwort, an der gerade geschrieben wird — nur die atmet. */
  live?: boolean
}) {
  const text = useMemo(
    () => message.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n'),
    [message.parts]
  )
  const thinking = message.parts.filter((p) => p.type === 'thinking').map((p) => (p as { text: string }).text).join('\n')
  const images = message.parts.filter((p) => p.type === 'image') as { type: 'image'; mediaType: string; dataBase64: string }[]
  const files = message.parts.filter((p) => p.type === 'file') as { type: 'file'; name: string; text: string }[]
  const metrics = message.parts.find((p) => p.type === 'metrics') as MetricsPart | undefined
  const [copied, setCopied] = useState(false)
  /** Text im Bearbeiten-Feld; null heißt: nicht in Bearbeitung. */
  const [bearbeitet, setBearbeitet] = useState<string | null>(null)

  if (message.role === 'user' && bearbeitet !== null) {
    const senden = (): void => {
      const neu = bearbeitet.trim()
      if (!neu) return
      setBearbeitet(null)
      if (neu !== text.trim()) void appStore.bearbeiteNachricht(message.chatId, message.id, neu, model)
    }
    return (
      <div className="msg-user-block msg-user-block--bearbeiten">
        <div className="msg-bearbeiten">
          <textarea
            className="input"
            autoFocus
            rows={Math.min(12, bearbeitet.split('\n').length + 1)}
            value={bearbeitet}
            onChange={(e) => setBearbeitet(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                senden()
              }
              if (e.key === 'Escape') setBearbeitet(null)
            }}
          />
          <div className="msg-bearbeiten__knoepfe">
            <button type="button" className="btn" data-variant="ghost" onClick={() => setBearbeitet(null)}>
              {t('chat.editCancel')}
            </button>
            <button type="button" className="btn" data-variant="primary" disabled={!bearbeitet.trim()} onClick={senden}>
              {t('chat.editSend')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (message.role === 'user') {
    return (
      <div className="msg-user-block">
      <div className="msg-user">
        {images.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: text ? 8 : 0, flexWrap: 'wrap' }}>
            {images.map((image, index) => (
              <img
                key={index}
                src={`data:${image.mediaType};base64,${image.dataBase64}`}
                alt=""
                style={{ maxWidth: 180, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
              />
            ))}
          </div>
        )}
        {files.map((file, index) => (
          <div key={index} className="tool-line" style={{ marginBottom: 4 }}>
            <IconFolder size={13} /> {file.name}
          </div>
        ))}
        {text}
      </div>
      <div className="msg-user__aktionen">
        <ZweigNav message={message} streaming={streaming} t={t} />
        <button
          type="button"
          className="icon-btn"
          title={copied ? t('chat.copied') : t('chat.copy')}
          aria-label={t('chat.copy')}
          onClick={() => {
            void window.desk.shell.copy(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1400)
          }}
        >
          {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
        </button>
        <button type="button" className="icon-btn" title={t('chat.edit')} aria-label={t('chat.edit')} disabled={streaming} onClick={() => setBearbeitet(text)}>
          <IconPencil size={13} />
        </button>
      </div>
      </div>
    )
  }

  return (
    <div className="msg-assistant">
      {/* Das Zeichen steht links neben der Antwort, außerhalb des Textes — auf
          Höhe der Zeile, die gerade entsteht („Denkt nach …“, dann die
          wachsende Antwort). Nach dem Lauf bleibt es bei der neuesten stehen. */}
      <div className="msg-assistant__rand">
        {(live || juengste) && (
          <div className="msg-assistant__mark" data-live={live || undefined}>
            <LogoMark size={18} active={live} />
          </div>
        )}
      </div>
      <div className="msg-body">
        {thinking && <ThinkingBlock text={thinking} streaming={!text && live} t={t} />}
        {buildTimeline(message.parts).map((entry, index) => {
          // Der Denktext steht als eigenes Feld oben; in der Zeitlinie wäre er doppelt.
          if (entry.kind === 'thinking') return null
          if (entry.kind === 'text')
            return (
              <div className="timeline__text" key={`text-${index}`}>
                <Markdown text={entry.text} />
              </div>
            )
          if (entry.kind === 'tools')
            return <ToolTimeline steps={entry.steps} live={Boolean(live)} wartet={wartet} t={t} key={`tools-${index}`} />
          if (entry.kind === 'image')
            return (
              <img
                src={`data:${entry.mediaType};base64,${entry.dataBase64}`}
                alt=""
                key={`image-${index}`}
                style={{ maxWidth: 180, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
              />
            )
          if (entry.kind === 'file')
            return (
              <div className="tool-line" key={`file-${index}`}>
                <IconFolder size={13} /> {entry.name}
              </div>
            )
          return (
            <button type="button" className="doc-card" key={`${entry.path}-${index}`} onClick={() => appStore.openPanel({ path: entry.path, title: entry.title })}>
              <span className="doc-card__mark">
                <IconFile size={18} />
              </span>
              <span className="doc-card__zeilen">
                <span className="doc-card__name">{baseName(entry.path)}</span>
                <span className="doc-card__meta">
                  {t('docs.asDocument', { kind: shortKind(entry.documentKind) })}
                  {typeof entry.bytes === 'number' ? ` · ${formatBytes(entry.bytes)}` : ''}
                </span>
              </span>
            </button>
          )
        })}
        {/* „Denkt nach" nur, solange wirklich nichts anderes zu sehen ist —
            nicht unter einem Werkzeugschritt, der auf eine Freigabe wartet. */}
        {!text && live && !thinking && !wartet && !message.error && !message.parts.some((p) => p.type === 'tool_call') && (
          <div style={{ color: 'var(--text-faint)' }}>{t('chat.thinking')}</div>
        )}
        {message.error && <div className="msg-error">{message.error}</div>}
      </div>
      {/* Knöpfe und Durchsatz in eigener Zeile: So steht das Zeichen links
          immer an der letzten Textzeile, nicht bei den Knöpfen. */}
      <div className="msg-fuss">
        {/* Auch eine Antwort nur aus Werkzeugschritten (Agent) lässt sich
            wiederholen und hat ihre Fassungen. */}
        {(text || message.error || message.parts.length > 0) && !streaming && (
          <div className="msg-aktionen">
            <ZweigNav message={message} streaming={streaming} t={t} />
            {text && (<>
            <button
              type="button"
              className="btn"
              data-variant="ghost"
              title={t('chat.copy')}
              onClick={() => {
                void window.desk.shell.copy(text)
                setCopied(true)
                setTimeout(() => setCopied(false), 1400)
              }}
            >
              <IconCopy size={13} /> {copied ? t('chat.copied') : t('chat.copy')}
            </button>
            <ArtifactButton text={text} t={t} />
            <ExportMenu text={text} title={chatTitle(text)} t={t} />
            </>)}
            <button type="button" className="btn" data-variant="ghost" title={t('chat.retry')} onClick={() => void appStore.neuAntworten(message.chatId, message.id, model)}>
              <IconRetry size={13} /> {t('chat.retry')}
            </button>
          </div>
        )}
        {metrics && !streaming && <MetricsLine metrics={metrics} t={t} />}
      </div>
    </div>
  )
}

/** ‹ 2 / 3 ›: zwischen den Fassungen an dieser Stelle wechseln. */
function ZweigNav({ message, streaming, t }: { message: Message; streaming: boolean; t: Translate }) {
  const zweig = message.zweig
  if (!zweig || zweig.anzahl < 2) return null
  return (
    <span className="zweig">
      <button
        type="button"
        className="icon-btn"
        aria-label={t('chat.prevVersion')}
        title={t('chat.prevVersion')}
        disabled={streaming || zweig.index <= 1}
        onClick={() => void appStore.wechsleZweig(message.chatId, message.id, -1)}
      >
        <IconBack size={13} />
      </button>
      <span className="zweig__zahl">
        {zweig.index} / {zweig.anzahl}
      </span>
      <button
        type="button"
        className="icon-btn"
        aria-label={t('chat.nextVersion')}
        title={t('chat.nextVersion')}
        disabled={streaming || zweig.index >= zweig.anzahl}
        onClick={() => void appStore.wechsleZweig(message.chatId, message.id, 1)}
      >
        <IconForward size={13} />
      </button>
    </span>
  )
}

/**
 * Durchsatzzeile unter der fertigen Antwort. Die Zahl stammt vom Anbieter;
 * meldet er nichts, steht sie als Schätzung da, damit niemand sie für eine
 * Messung hält.
 */
function MetricsLine({ metrics, t }: { metrics: MetricsPart; t: Translate }) {
  const details = [
    `${metrics.outputTokens.toLocaleString('de-DE')} ${t('chat.metricsOutput')}`,
    typeof metrics.inputTokens === 'number'
      ? `${metrics.inputTokens.toLocaleString('de-DE')} ${t('chat.metricsInput')}`
      : null,
    `${formatDuration(metrics.durationMs)} ${t('chat.metricsDuration')}`,
    metrics.estimated ? t('chat.metricsEstimated') : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className="msg-metrics"
      title={`${t('chat.metricsHint')}\n${details}`}
      data-rate={metrics.perSecond}
      data-output={metrics.outputTokens}
      data-duration={metrics.durationMs}
      data-estimated={metrics.estimated}
    >
      <IconGauge size={12} />
      <span>
        {formatRate(metrics.perSecond)} {t('chat.tokensPerSecond')}
      </span>
      {metrics.estimated && <span className="msg-metrics__estimated">({t('chat.metricsEstimated')})</span>}
      <span className="msg-metrics__detail">{details}</span>
    </div>
  )
}

/** Rettert die Antwort als eigenständiges Artifact (Codeblock oder ganzer Text). */
function ArtifactButton({ text, t }: { text: string; t: Translate }) {
  const [saved, setSaved] = useState(false)
  return (
    <button
      type="button"
      className="btn"
      data-variant="ghost"
      title={t('chat.saveArtifact')}
      onClick={() => {
        const fenced = /```(\w*)\n([\s\S]*?)```/.exec(text)
        const language = fenced?.[1]?.toLowerCase() ?? ''
        const body = fenced?.[2] ?? text
        const kind: import('@shared/types').ArtifactKind =
          language === 'html' ? 'html' : language === 'svg' ? 'svg' : language === 'md' || language === 'markdown' ? 'markdown' : language ? 'code' : 'markdown'
        const firstLine = (fenced ? text.split('\n')[0] : text.split('\n')[0]) ?? 'Ohne Titel'
        void appStore.createArtifact({ title: firstLine.replace(/^#+\s*/, '').slice(0, 80) || 'Ohne Titel', kind, body: body.trim() })
        setSaved(true)
        setTimeout(() => setSaved(false), 1600)
      }}
    >
      <IconSpark size={13} /> {saved ? t('chat.saved') : t('chat.saveArtifact')}
    </button>
  )
}

/**
 * Der Gedankengang: immer zu sehen, zugeklappt drei Zeilen hoch.
 *
 * Solange das Modell denkt, zeigen die drei Zeilen das Neueste — man liest
 * mit. Danach den Anfang, mit einem sanften Auslaufen nach unten. Ein Klick
 * (auf die Zeile oder die Überschrift) klappt alles auf und wieder zu.
 */
function ThinkingBlock({ text, streaming, t }: { text: string; streaming: boolean; t: Translate }) {
  const [open, setOpen] = useState(false)
  const kasten = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const feld = kasten.current
    if (!feld || open) return
    // Beim Mitlesen ans Ende, danach an den Anfang.
    feld.scrollTop = streaming ? feld.scrollHeight : 0
  }, [text, streaming, open])

  return (
    <div className="denken" data-offen={open || undefined} data-live={streaming || undefined}>
      <button type="button" className="denken__kopf" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>{streaming ? t('chat.thinking') : t('chat.thoughts')}</span>
        <IconChevronDown size={13} className="denken__pfeil" />
      </button>
      <div
        ref={kasten}
        className={open ? 'thinking' : 'thinking thinking--zu'}
        onClick={() => !open && setOpen(true)}
        title={open ? undefined : t('chat.thoughtsOpen')}
      >
        {text}
      </div>
    </div>
  )
}

function compact(value: unknown): string {
  const json = JSON.stringify(value ?? {})
  return json.length > 90 ? `${json.slice(0, 90)}…` : json
}

type MetricsPart = { type: 'metrics' } & MessageMetrics

/** Antwort als Datei ausgeben: Markdown, Word oder PDF — jeweils rechts in der Vorschau. */
function ExportMenu({ text, title, t }: { text: string; title: string; t: Translate }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<DocumentKind | null>(null)
  const chatId = useApp((state) => state.activeChatId)

  const run = async (kind: DocumentKind): Promise<void> => {
    setOpen(false)
    setBusy(kind)
    try {
      await appStore.createDocument({ kind, markdown: text, title, chatId: chatId ?? undefined })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="btn" data-variant="ghost" title={t('docs.export')} onClick={() => setOpen((v) => !v)}>
        <IconChevronDown size={13} /> {busy ? t('docs.exported') : t('docs.export')}
      </button>
      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 20 }}
            onClick={() => setOpen(false)}
          />
          <div className="menu" style={{ position: 'absolute', bottom: 30, left: 0, zIndex: 21 }}>
            {(['markdown', 'docx', 'pdf'] as DocumentKind[]).map((kind) => (
              <button type="button" className="menu__item" key={kind} onClick={() => void run(kind)}>
                {kind === 'markdown' ? 'Markdown (.md)' : kind === 'docx' ? 'Word (.docx)' : 'PDF (.pdf)'}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** Erste Überschrift, sonst die ersten Wörter der Antwort als Dateiname. */
function chatTitle(text: string): string {
  // Ohne Markdown-Zeichen: sonst standen „**Wort**“ im PDF-Titel und im Dateinamen.
  const klar = (zeile: string): string =>
    zeile
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~#>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  const heading = /^\s*#{1,6}\s+(.+)$/m.exec(text)
  if (heading?.[1] && klar(heading[1])) return klar(heading[1]).slice(0, 60)
  // Sonst der erste Satz, höchstens acht Wörter — und keine halbe Klammer.
  const satz = klar(text.trim().split(/\n/)[0] ?? '').split(/(?<=[.!?:])\s/)[0] ?? ''
  let titel = satz.split(' ').slice(0, 8).join(' ').replace(/[.:!?,;]+$/, '')
  const offen = titel.lastIndexOf('(')
  if (offen > titel.lastIndexOf(')')) titel = titel.slice(0, offen).trim()
  return titel.slice(0, 60) || 'Antwort'
}

/** Kurzer Artname unter dem Dateinamen — „Markdown" in Großbuchstaben ist zu lang. */
function shortKind(kind: string): string {
  return kind === 'markdown' ? 'MD' : kind.toUpperCase()
}

/**
 * Gebundene Werkzeugformulierungen. Die Schlüssel stehen als ganze Wörter da,
 * damit der Übersetzer sie prüft — ein zusammengebauter String wäre blind.
 */
const STEP_KEYS = {
  list_dir: { one: 'step.list_dir', many: 'step.list_dir.plural', pending: 'step.list_dir.pending' },
  read_file: { one: 'step.read_file', many: 'step.read_file.plural', pending: 'step.read_file.pending' },
  search_files: { one: 'step.search_files', many: 'step.search_files.plural', pending: 'step.search_files.pending' },
  write_file: { one: 'step.write_file', many: 'step.write_file.plural', pending: 'step.write_file.pending' },
  edit_file: { one: 'step.edit_file', many: 'step.edit_file.plural', pending: 'step.edit_file.pending' },
  run_command: { one: 'step.run_command', many: 'step.run_command.plural', pending: 'step.run_command.pending' },
  create_document: { one: 'step.create_document', many: 'step.create_document.plural', pending: 'step.create_document.pending' },
  todo: { one: 'step.todo', many: 'step.todo.plural', pending: 'step.todo.pending' },
  websuche: { one: 'step.websuche', many: 'step.websuche.plural', pending: 'step.websuche.pending' },
  webseite_lesen: { one: 'step.webseite_lesen', many: 'step.webseite_lesen.plural', pending: 'step.webseite_lesen.pending' },
  recherche: { one: 'step.recherche', many: 'step.recherche.plural', pending: 'step.recherche.pending' },
  tiefenrecherche: { one: 'step.tiefenrecherche', many: 'step.tiefenrecherche.plural', pending: 'step.tiefenrecherche.pending' },
  tiefenrecherche_plan: { one: 'step.tiefenrecherche_plan', many: 'step.tiefenrecherche_plan.plural', pending: 'step.tiefenrecherche_plan.pending' },
  tiefenrecherche_luecken: { one: 'step.tiefenrecherche_luecken', many: 'step.tiefenrecherche_luecken.plural', pending: 'step.tiefenrecherche_luecken.pending' },
  chats_durchsuchen: { one: 'step.chats_durchsuchen', many: 'step.chats_durchsuchen.plural', pending: 'step.chats_durchsuchen.pending' },
  letzte_chats: { one: 'step.letzte_chats', many: 'step.letzte_chats.plural', pending: 'step.letzte_chats.pending' },
  dokument_lesen: { one: 'step.dokument_lesen', many: 'step.dokument_lesen.plural', pending: 'step.dokument_lesen.pending' },
  dokument_bearbeiten: { one: 'step.dokument_bearbeiten', many: 'step.dokument_bearbeiten.plural', pending: 'step.dokument_bearbeiten.pending' },
  dokument_wiederherstellen: { one: 'step.dokument_wiederherstellen', many: 'step.dokument_wiederherstellen.plural', pending: 'step.dokument_wiederherstellen.pending' },
  erinnerung_merken: { one: 'step.erinnerung_merken', many: 'step.erinnerung_merken.plural', pending: 'step.erinnerung_merken.pending' },
  erinnerung_aendern: { one: 'step.erinnerung_aendern', many: 'step.erinnerung_aendern.plural', pending: 'step.erinnerung_aendern.pending' },
  erinnerung_loeschen: { one: 'step.erinnerung_loeschen', many: 'step.erinnerung_loeschen.plural', pending: 'step.erinnerung_loeschen.pending' },
  projekt_durchsuchen: { one: 'step.projekt_durchsuchen', many: 'step.projekt_durchsuchen.plural', pending: 'step.projekt_durchsuchen.pending' },
  projekt_datei_lesen: { one: 'step.projekt_datei_lesen', many: 'step.projekt_datei_lesen.plural', pending: 'step.projekt_datei_lesen.pending' },
  other: { one: 'step.other', many: 'step.other.plural', pending: 'step.other.pending' }
} as const

/** Sekundenzähler für einen laufenden Schritt — null, wenn nichts läuft. */
function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0)
  const started = useRef<number | null>(null)

  useEffect(() => {
    if (!active) {
      started.current = null
      setSeconds(0)
      return
    }
    started.current = Date.now()
    const tick = setInterval(() => {
      if (started.current !== null) setSeconds(Math.round((Date.now() - started.current) / 1000))
    }, 1000)
    return () => clearInterval(tick)
  }, [active])

  return active ? seconds : 0
}

/**
 * Ein Block Werkzeugschritte: oben eine Zeile, die sagt, was hier insgesamt
 * geschah, darunter die Schritte mit Linie dazwischen. Rohe Argumente bleiben
 * auf Zuruf sichtbar — verschwinden tut nichts.
 */
function ToolTimeline({ steps, live, wartet, t }: { steps: ToolStep[]; live: boolean; wartet: boolean; t: Translate }) {
  const [open, setOpen] = useState(false)
  // `findLastIndex` fehlt im eingestellten Sprachziel; von hinten zählen tut es auch.
  let pendingIndex = -1
  for (let index = steps.length - 1; index >= 0; index--) {
    if (steps[index]!.pending) {
      pendingIndex = index
      break
    }
  }
  const elapsed = useElapsed(live && pendingIndex >= 0)

  const phrase = (key: string, count: number): string => {
    const entry = STEP_KEYS[key as keyof typeof STEP_KEYS] ?? STEP_KEYS.other
    return `${count} ${t(count === 1 ? entry.one : entry.many)}`
  }

  return (
    <div className="timeline" data-steps={steps.length}>
      {summarize(steps, phrase) && <div className="timeline__summary">{summarize(steps, phrase)}</div>}
      <ol className="timeline__list">
        {steps.map((step, index) => {
          const key = stepKey(step.tool)
          const entry = STEP_KEYS[key as keyof typeof STEP_KEYS] ?? STEP_KEYS.other
          const pending = step.pending && index === pendingIndex && live
          // Offen, aber der Lauf ist vorbei (abgebrochen, Fehler): nicht ewig „läuft“.
          const abgebrochen = step.pending && !live
          const detail = stepDetail(step)
          return (
            <li className="timeline__step" key={step.id} data-status={abgebrochen ? 'error' : step.pending ? 'pending' : step.ok === false ? 'error' : 'done'}>
              <span className="timeline__dot" aria-hidden="true" />
              {/* Vergangenheit erst, wenn es geschehen ist — vorher die Verlaufsform. */}
              <span className="timeline__phrase">{t(step.pending && !abgebrochen ? entry.pending : entry.one)}</span>
              {detail && <span className="timeline__detail">{detail}</span>}
              {abgebrochen && <span className="timeline__running">{t('timeline.stopped')}</span>}
              {pending && (
                <span className="timeline__running">
                  {wartet ? t('timeline.waiting') : t('timeline.running', { seconds: String(elapsed) })}
                </span>
              )}
              {step.pending ? null : step.ok === false && <span className="timeline__flag" aria-hidden="true">✕</span>}
            </li>
          )
        })}
      </ol>
      <button type="button" className="timeline__toggle" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        {t('timeline.details')}
      </button>
      {open && (
        <div className="timeline__raw">
          {steps.map((step) => (
            <div className="timeline__raw-step" key={step.id}>
              <code>
                {step.tool}({compact(step.args)})
              </code>
              {step.output !== undefined && <pre>{step.output}</pre>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
