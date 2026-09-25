/**
 * Mobile-Ansicht: schaltet den Zugang für das Handy ein und zeigt den Code,
 * mit dem es sich anmeldet.
 *
 * Der Knopf ist absichtlich der sicherere Zustand: Aus. Erst wenn jemand ihn
 * drückt, horcht der Rechner im Netz — und der Code dazu gilt nur für diese
 * Sitzung.
 */
import { useEffect, useState } from 'react'
import type { MobileStatus } from '@shared/types'
import type { Translate } from '../../i18n'
import { IconCheck } from '../../components/Icons'

/**
 * Gezeichnetes Telefon als Vorgeschmack: oben der Namen mit dem Status, darunter
 * im laufenden Zustand zwei Nachrichtenblasen, im ruhenden ein leeres Raster.
 * Das ist Absicht — wer es einschaltet, soll sehen, was dabei entsteht.
 */
/**
 * Ein aufgeklappter Rechner, ebenso gezeichnet wie das Handy: Rahmen, Raster,
 * und wenn der Zugang an ist, liegt ein Gespräch auf dem Bildschirm.
 */
function LaptopMark({ running }: { running: boolean }): React.JSX.Element {
  return (
    <svg className="rechner" viewBox="0 0 300 196" width="268" height="175" role="img" aria-label="">
      <rect x="42" y="8" width="216" height="146" rx="12" fill="none" stroke="var(--border-strong)" strokeWidth="2" />
      <rect x="52" y="18" width="196" height="126" rx="6" fill="var(--bg-sunken)" />
      {Array.from({ length: 6 }, (__, k) => (
        <line key={`s${k}`} x1={52 + (k + 1) * 28} y1="18" x2={52 + (k + 1) * 28} y2="144" stroke="var(--border)" strokeWidth="1" />
      ))}
      {Array.from({ length: 4 }, (__, k) => (
        <line key={`w${k}`} x1="52" y1={18 + (k + 1) * 25} x2="248" y2={18 + (k + 1) * 25} stroke="var(--border)" strokeWidth="1" />
      ))}
      {running ? (
        <g>
          <rect x="72" y="40" width="120" height="10" rx="5" fill="var(--accent)" opacity="0.5" />
          <rect x="96" y="62" width="132" height="10" rx="5" fill="var(--border-strong)" />
          <rect x="72" y="84" width="96" height="10" rx="5" fill="var(--border-strong)" opacity="0.7" />
        </g>
      ) : (
        <rect x="128" y="64" width="44" height="34" rx="6" fill="none" stroke="var(--border-strong)" strokeWidth="2" />
      )}
      <path d="M18 154h264l14 24a6 6 0 0 1-5 9H9a6 6 0 0 1-5-9z" fill="none" stroke="var(--border-strong)" strokeWidth="2" />
      <path d="M120 166h60" stroke="var(--border-strong)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function PhoneMark({ running, statusLabel }: { running: boolean; statusLabel: string }): React.JSX.Element {
  return (
    <svg className="phone" viewBox="0 0 260 460" width="232" height="410" role="img" aria-label="">
      <rect className="phone__case" x="10" y="10" width="240" height="440" rx="42" />
      <rect className="phone__screen" x="22" y="22" width="216" height="416" rx="32" />
      <rect className="phone__notch" x="106" y="30" width="48" height="7" rx="3.5" />

      <text className="phone__title" x="130" y="76" textAnchor="middle">
        Hestia
      </text>
      {/* Status als Plakette: Punkt und Wort, wie auf dem echten Bildschirm. */}
      <g>
        <rect className={running ? 'phone__pill phone__pill--on' : 'phone__pill'} x="82" y="86" width="96" height="20" rx="10" />
        <circle className={running ? 'phone__led phone__led--on' : 'phone__led'} cx="96" cy="96" r="3.2" />
        <text className="phone__pill-text" x="106" y="100">
          {statusLabel}
        </text>
      </g>

      {running ? (
        <>
          <rect className="phone__bubble phone__bubble--mine" x="96" y="150" width="120" height="66" rx="16" />
          <rect className="phone__line" x="108" y="166" width="96" height="6" rx="3" />
          <rect className="phone__line" x="108" y="180" width="84" height="6" rx="3" />
          <rect className="phone__line" x="108" y="194" width="62" height="6" rx="3" />
          <rect className="phone__bubble" x="44" y="230" width="150" height="36" rx="16" />
          <rect className="phone__line phone__line--dim" x="56" y="244" width="112" height="6" rx="3" />
          <rect className="phone__field" x="44" y="356" width="172" height="40" rx="20" />
          <path className="phone__caret" d="M62 376h20" />
          <circle className="phone__send" cx="200" cy="376" r="16" />
          <path className="phone__arrow" d="M200 383v-14M195 374l5-5 5 5" />
        </>
      ) : (
        <g className="phone__grid">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
            <line key={`h${row}`} x1="34" y1={140 + row * 28} x2="226" y2={140 + row * 28} />
          ))}
          {[0, 1, 2, 3, 4, 5, 6].map((col) => (
            <line key={`v${col}`} x1={40 + col * 30} y1="136" x2={40 + col * 30} y2="360" />
          ))}
        </g>
      )}
    </svg>
  )
}

export function MobileView({ t }: { t: Translate }): React.JSX.Element {
  const [status, setStatus] = useState<MobileStatus | null>(null)
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    void window.desk.mobile.status().then(setStatus)
  }, [])

  const toggle = async (): Promise<void> => {
    setPending(true)
    setError(undefined)
    try {
      const next = status?.running ? await window.desk.mobile.stop() : await window.desk.mobile.start()
      setStatus(next)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPending(false)
    }
  }

  const [kopiert, setKopiert] = useState<string | null>(null)

  const copy = async (): Promise<void> => {
    if (!status?.url) return
    await window.desk.shell.copy(status.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  // Die Adresse ist ohne den Zugangsstand gemeint — der steht nur im Code.
  const address = status?.url ? status.url.split('/?')[0] : undefined
  const running = Boolean(status?.running)

  return (
    <div className="main__scroll">
      <div className="pane pane--dispatch">
        <div className="dispatch">
          <div className="dispatch__stage">
            <PhoneMark running={running} statusLabel={running ? t('dispatch.status.on') : t('dispatch.status.off')} />
            <LaptopMark running={running} />
          </div>
          <h2 className="dispatch__title">{t('dispatch.headline')}</h2>
          <p className="dispatch__subline">{t('dispatch.subline')}</p>
          {/* Im Browser ist man über genau diesen Zugang hier — ihn von hier
              auszuschalten, sperrte das Gerät aus. Das geht nur am Rechner. */}
          {window.desk.fern ? (
            <p className="dispatch__fine">{t('mobile.viaRemote')}</p>
          ) : (
            <button type="button" className="dispatch__button" disabled={pending} onClick={() => void toggle()}>
              {running ? t('mobile.stop') : t('dispatch.connect')}
            </button>
          )}
          <p className="dispatch__fine">{t('dispatch.fine')}</p>
          <p className="dispatch__fine dispatch__fine--zweit">{t('dispatch.alsoLaptop')}</p>
        </div>

        {error && <p className="dispatch__error">{t('mobile.error')} {error}</p>}

        {running && (
          <div className="card dispatch__details">
            <div className="dispatch__state">
              <span className={status?.running ? 'dispatch__led dispatch__led--on' : 'dispatch__led'} />
              <span className="dispatch__state-text">{status?.running ? t('dispatch.status.on') : t('dispatch.status.off')}</span>
              {typeof status?.clients === 'number' && <span className="dispatch__clients">{t('mobile.devices')}: {status.clients}</span>}
            </div>

            {status?.qr && (
              <div className="dispatch__qr">
                {/* Der Code enthält Adresse und Zugangsstand. */}
                <img src={status.qr} alt="" width={216} height={216} />
              </div>
            )}

            {/* Über Tailscale per https: auch unterwegs, als App ohne
                Browserleisten auf dem Home-Bildschirm, mit Mikrofon. */}
            {status?.sicher && (
              <div className="dispatch__sicher">
                <div className="dispatch__label">{t('mobile.secure')}</div>
                <p className="dispatch__fine" style={{ margin: '0 0 8px' }}>{t('mobile.secureHint')}</p>
                {status.sicherQr && <img src={status.sicherQr} alt="" width={168} height={168} className="dispatch__sicher-qr" />}
                <div className="dispatch__address">
                  <code>{status.sicher.split('/?')[0]}</code>
                  <button
                    type="button"
                    className="btn"
                    data-variant="ghost"
                    onClick={() => {
                      void window.desk.shell.copy(status.sicher!)
                      setKopiert('sicher')
                      setTimeout(() => setKopiert(null), 1400)
                    }}
                  >
                    {kopiert === 'sicher' ? <IconCheck size={13} /> : null} {kopiert === 'sicher' ? t('mobile.copied') : t('mobile.copy')}
                  </button>
                </div>
              </div>
            )}

            <div className="dispatch__label">{t('mobile.address')}</div>
            <div className="dispatch__address">
              <code>{address}</code>
              <button type="button" className="btn" data-variant="ghost" onClick={() => void copy()}>
                {copied ? <IconCheck size={13} /> : null} {copied ? t('mobile.copied') : t('mobile.copy')}
              </button>
            </div>

            {(status?.addresses?.length ?? 0) > 1 && (
              <div className="dispatch__others">
                <div className="dispatch__label">{t('mobile.otherAddresses')}</div>
                <div className="dispatch__others-list">
                  {status?.addresses?.map((entry) => (
                    <button
                      type="button"
                      key={entry}
                      className="btn"
                      data-variant="ghost"
                      style={{ fontSize: 12 }}
                      // Mit Zugangscode: ohne ihn ließe der Rechner das Gerät
                      // nicht herein, und die Ersatzadresse wäre wertlos.
                      onClick={() => {
                        const mitCode = status.url ? status.url.replace(/\/\/[^:/]+/, `//${entry}`) : `http://${entry}:${status.port}`
                        void window.desk.shell.copy(mitCode)
                        setKopiert(entry)
                        setTimeout(() => setKopiert(null), 1400)
                      }}
                    >
                      {kopiert === entry ? <IconCheck size={13} /> : null} {entry}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="dispatch__fine dispatch__fine--card">{t('mobile.security')}</p>
            {!window.desk.fern && (
            <button
              type="button"
              className="btn"
              data-variant="ghost"
              style={{ fontSize: 12, alignSelf: 'flex-start' }}
              onClick={async () => {
                if (!confirm(t('mobile.newCodeConfirm'))) return
                setStatus(await window.desk.mobile.newCode())
              }}
            >
              {t('mobile.newCode')}
            </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
