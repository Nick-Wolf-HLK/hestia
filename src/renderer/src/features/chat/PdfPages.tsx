/**
 * PDF seitenweise, wie Papier übereinander.
 *
 * Der eingebaute Chromium-Betrachter wäre billiger zu haben, bringt aber seine
 * eigene graue Arbeitsfläche und Werkzeugleiste mit. Hier steht stattdessen
 * jede Seite als eigenes Blatt: hell, mit Rand und Schatten, in der Spalte
 * zentriert. Rendert pdf.js in eine Leinwand — zweifach vergrößert, damit die
 * Schrift auch beim Zurückskalieren scharf bleibt.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Translate } from '../../i18n'

/**
 * Der Arbeiter wird aus dem von Vite ausgelieferten Modul gebaut — pdf.js v6
 * will den Hafen, nicht die Adresse. Ein Arbeiter pro Dokument: billig genug
 * für eine Vorschau und ohne geteilten Zustand, der überleben könnte.
 */
function createWorker(): { worker: pdfjs.PDFWorker; port: Worker } {
  const port = new Worker(workerUrl, { type: 'module' })
  // Die Fabrik, nicht der Konstruktor: der nimmt den Hafen in den Typen nicht an.
  return { worker: pdfjs.PDFWorker.create({ port }), port }
}

/** Zweifach gerendert, per CSS eingepasst: bleibt beim Schmalziehen lesbar. */
const RENDER_SCALE = 2

interface Props {
  base64: string
  /** Für den Ausweg „Mit Standard-App öffnen“, falls die Vorschau scheitert. */
  path?: string
  t: Translate
}

/** So lange darf das Öffnen dauern, bevor ein frischer Arbeiter es noch einmal versucht. */
const OEFFNEN_BIS_MS = 10_000

/** Ein Versprechen mit Frist: hängt pdf.js, gibt es statt Stille eine Meldung. */
function mitFrist<T>(versprechen: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const uhr = setTimeout(() => reject(new Error('Zeitüberschreitung')), ms)
    versprechen.then(
      (wert) => {
        clearTimeout(uhr)
        resolve(wert)
      },
      (fehler: unknown) => {
        clearTimeout(uhr)
        reject(fehler instanceof Error ? fehler : new Error(String(fehler)))
      }
    )
  })
}

function bytesFrom(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function PdfPages({ base64, path, t }: Props): React.JSX.Element {
  // Das Wort für „Seite" als eigener Wert: die Wirkung unten hängt an diesem
  // Text, nicht an der Übersetzungsfunktion — die wäre bei jedem Neuzeichnen
  // eine neue und würde den ganzen Stapel umsonst rendern.
  const sheetWord = t('panel.sheetWord')
  const stack = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [count, setCount] = useState(0)
  // Hochzählen heißt: noch einmal von vorn, mit neuem Arbeiter.
  const [versuch, setVersuch] = useState(0)
  const bytes = useMemo(() => bytesFrom(base64), [base64])

  useEffect(() => {
    const host = stack.current
    if (!host) return
    let alive = true
    let doc: PDFDocumentProxy | null = null
    // Arbeiter, die hier entstehen — beim Aufräumen gehen alle, auch ein hängengebliebener.
    const arbeiter: { worker: pdfjs.PDFWorker; port: Worker }[] = []
    setError(undefined)
    setCount(0)
    host.replaceChildren()

    /** Öffnen mit Frist; hängt der erste Arbeiter, versucht es ein frischer noch einmal. */
    const oeffnen = async (): Promise<PDFDocumentProxy> => {
      for (let runde = 1; ; runde++) {
        const neu = createWorker()
        arbeiter.push(neu)
        // pdf.js verändert das übergebene Array beim Parsen — eine Kopie schützt.
        const aufgabe = pdfjs.getDocument({ data: bytes.slice(), worker: neu.worker })
        try {
          return await mitFrist(aufgabe.promise, OEFFNEN_BIS_MS)
        } catch (fehler) {
          void aufgabe.destroy()
          if (runde >= 2 || !alive) throw fehler
        }
      }
    }

    void (async () => {
      try {
        doc = await oeffnen()
        if (!alive) return
        setCount(doc.numPages)

        const sheets: HTMLElement[] = []
        for (let number = 1; number <= doc.numPages; number++) {
          const page = await doc.getPage(number)
          const viewport = page.getViewport({ scale: RENDER_SCALE })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.className = 'pdf-page'
          const context = canvas.getContext('2d')
          if (!context) continue
          await page.render({ canvas, canvasContext: context, viewport }).promise
          if (!alive) return

          // Blatt mit Plakette unten rechts: welche Seite das hier ist.
          const sheet = document.createElement('div')
          sheet.className = 'pdf-sheet'
          const badge = document.createElement('span')
          badge.className = 'pdf-sheet__badge'
          badge.dataset.page = String(number)
          sheet.append(canvas, badge)
          sheets.push(sheet)
          host.appendChild(sheet)
        }
        // Die Gesamtzahl kennt man erst hier — vorher alle Plaketten zu füllen
        // hieße, „Seite 1 / ?" dazustellen.
        for (const sheet of sheets) {
          const badge = sheet.querySelector<HTMLElement>('.pdf-sheet__badge')
          if (badge) badge.textContent = `${sheetWord} ${badge.dataset.page ?? '1'} / ${doc.numPages}`
        }
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()

    return () => {
      alive = false
      void doc?.loadingTask.destroy()
      for (const { worker, port } of arbeiter) {
        worker.destroy()
        port.terminate()
      }
    }
  }, [bytes, sheetWord, versuch])

  return (
    <div className="pdf-stack-wrap">
      {!error && count === 0 && <div className="doc-panel__hint">{t('panel.loading')}</div>}
      {error && (
        <div className="doc-panel__notice">
          {t('panel.pdfFailed')} ({error})
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={() => setVersuch((n) => n + 1)}>
              {t('panel.retry')}
            </button>
            {path && (
              <button type="button" className="btn" onClick={() => void window.desk.documents.open(path)}>
                {t('docs.openExternal')}
              </button>
            )}
          </div>
        </div>
      )}
      <div className="pdf-stack" ref={stack} aria-label={t('panel.pdfPreview')} />
      {count > 0 && (
        <div className="pdf-count">
          {t(count === 1 ? 'panel.pageCountOne' : 'panel.pageCount', { count: String(count) })}
        </div>
      )}
    </div>
  )
}
