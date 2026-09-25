import type { Translate } from '../i18n'
import { IconSpark } from './Icons'

/** Ansicht im Aufbau: folgt strukturell der Navigation, Funktion kommt später. */
export function Placeholder({ title, t }: { title: string; t: Translate }) {
  return (
    <div className="main__scroll">
      <div className="pane">
        <h2 style={{ fontSize: 19, margin: '4px 0 16px' }}>{title}</h2>
        <div className="placeholder-page">
          <div style={{ color: 'var(--accent)', marginBottom: 10, display: 'flex', justifyContent: 'center' }}>
            <IconSpark size={26} />
          </div>
          <div style={{ fontSize: 15, color: 'var(--text)', marginBottom: 6 }}>{t('soon.title')}</div>
          <div style={{ maxWidth: 420, margin: '0 auto' }}>{t('soon.hint')}</div>
        </div>
      </div>
    </div>
  )
}
