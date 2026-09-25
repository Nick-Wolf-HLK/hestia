import { useEffect, useMemo, useRef } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { appStore } from '../lib/store'

/**
 * Klick auf einen Link in einer Antwort. Webadressen gehen in den Browser,
 * Pfade auf lokale Dateien in die Vorschau rechts. Nie darf das App-Fenster
 * selbst dorthin wechseln: Ein Link auf eine PDF ersetzte sonst die ganze
 * Oberfläche durch den PDF-Betrachter, ohne Weg zurück.
 */
function linkGeklickt(event: React.MouseEvent<HTMLDivElement>): void {
  const anker = (event.target as HTMLElement).closest('a')
  if (!anker) return
  const roh = anker.getAttribute('href') ?? ''
  if (roh.startsWith('#')) return
  event.preventDefault()
  if (/^https?:\/\//i.test(roh)) {
    window.open(roh, '_blank', 'noopener,noreferrer')
    return
  }
  let pfad = roh
  if (/^file:\/\//i.test(pfad)) pfad = new URL(pfad).pathname
  try {
    pfad = decodeURIComponent(pfad)
  } catch {
    /* schon lesbar */
  }
  if (pfad.startsWith('/') || /^~\//.test(pfad)) {
    appStore.openPanel({ path: pfad, title: pfad.split('/').pop() ?? pfad })
    return
  }
  // Nur der Dateiname: das gleichnamige Dokument aus diesem Chat öffnen.
  const name = pfad.split('/').pop() ?? pfad
  const zustand = appStore.get()
  const nachrichten = zustand.activeChatId ? (zustand.messages[zustand.activeChatId] ?? []) : []
  for (const nachricht of [...nachrichten].reverse()) {
    const teil = nachricht.parts.find((p) => p.type === 'document' && p.path.split('/').pop() === name)
    if (teil && teil.type === 'document') {
      appStore.openPanel({ path: teil.path, title: teil.title })
      return
    }
  }
}

/** Stellt Markdown als HTML dar und ergänzt Kopierknöpfe für Codeblöcke. */
export function Markdown({ text }: { text: string }) {
  const host = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderMarkdown(text), [text])

  useEffect(() => {
    const root = host.current
    if (!root) return
    for (const pre of Array.from(root.querySelectorAll('pre'))) {
      if (pre.querySelector('.copy-code')) continue
      const button = document.createElement('button')
      button.className = 'copy-code'
      button.type = 'button'
      button.textContent = 'Kopieren'
      button.addEventListener('click', () => {
        const code = pre.querySelector('code')?.textContent ?? ''
        void window.desk.shell.copy(code)
        button.textContent = 'Kopiert'
        setTimeout(() => (button.textContent = 'Kopieren'), 1400)
      })
      pre.appendChild(button)
    }
  }, [html])

  return <div className="md" ref={host} onClick={linkGeklickt} dangerouslySetInnerHTML={{ __html: html }} />
}
