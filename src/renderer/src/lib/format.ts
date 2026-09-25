import type { Translate } from '../i18n'

export function relativeTime(timestamp: number, t: Translate): string {
  const diff = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  if (diff < 2 * minute) return t('time.justNow')
  // Abrunden: 59,6 Minuten sind noch keine „vor 60 Minuten“.
  if (diff < hour) return t('time.minutesAgo', { n: Math.floor(diff / minute) })
  // Ab einer Stunde zählen Kalendertage — „Gestern“ heißt gestern, nicht „vor 24 Stunden“.
  const heute = new Date()
  heute.setHours(0, 0, 0, 0)
  const tage = Math.round((heute.getTime() - new Date(timestamp).setHours(0, 0, 0, 0)) / 86_400_000)
  if (tage <= 0) {
    const stunden = Math.max(1, Math.round(diff / hour))
    return stunden === 1 ? t('time.hourAgo') : t('time.hoursAgo', { n: stunden })
  }
  if (tage === 1) return t('time.yesterday')
  if (tage === 2) return t('time.dayBefore')
  if (tage < 7) return t('time.daysAgo', { n: tage })
  const datum = new Date(timestamp)
  return datum.toLocaleDateString(t('time.locale'), datum.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

export function baseName(path: string | undefined): string {
  if (!path) return ''
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** Lesbare Größe für Modellangaben. */
export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return kb < 10 ? `${kb.toFixed(1).replace('.', ',')} kB` : `${Math.round(kb)} kB`
  const mb = kb / 1024
  if (mb < 1024) return mb < 10 ? `${mb.toFixed(1).replace('.', ',')} MB` : `${Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(1).replace('.', ',')} GB`
}

/** Dateiarten, deren Text der Hauptprozess herausholt (dort liegen PDF- und ZIP-Leser). */
const AUSLESBAR = /\.(pdf|docx|odt|html?)$/i
const MAX_AUSLESBAR = 25 * 1024 * 1024
const MAX_TEXT = 2 * 1024 * 1024

/**
 * Dateien für das Eingabefeld aufbereiten: Bilder als Bild, alles andere als
 * Text. PDF, Word und OpenDocument liest der Hauptprozess — vorher kamen sie
 * als Binärsalat beim Modell an. Was nicht geht, steht in `fehler`.
 */
export async function readFilesAsAttachments(files: File[]): Promise<{
  images: { mediaType: string; dataBase64: string; name?: string }[]
  texts: { name: string; mediaType: string; text: string }[]
  fehler: string[]
}> {
  const images: { mediaType: string; dataBase64: string; name?: string }[] = []
  const texts: { name: string; mediaType: string; text: string }[] = []
  const fehler: string[] = []
  for (const file of files) {
    try {
      if (file.type.startsWith('image/')) {
        images.push({ mediaType: file.type, dataBase64: await toBase64(file), name: file.name || undefined })
      } else if (AUSLESBAR.test(file.name)) {
        if (file.size > MAX_AUSLESBAR) {
          fehler.push(`„${file.name}“ ist größer als 25 MB.`)
          continue
        }
        const { text } = await window.desk.dateien.lesen(file.name, await toBase64(file))
        texts.push({ name: file.name, mediaType: file.type || 'application/octet-stream', text })
      } else if (file.size <= MAX_TEXT) {
        const text = await file.text()
        // Ein Nullbyte heißt: keine Textdatei (Programm, Archiv, Tabelle im Binärformat).
        if (text.includes('\u0000')) fehler.push(`„${file.name}“: Dieses Format kann ich nicht lesen.`)
        else texts.push({ name: file.name, mediaType: file.type || 'text/plain', text })
      } else {
        fehler.push(`„${file.name}“ ist zu groß für eine Textdatei (höchstens 2 MB).`)
      }
    } catch (e) {
      fehler.push((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  return { images, texts, fehler }
}

export function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Laufzeit menschenlesbar: unter einer Minute mit Nachkommastelle, sonst Minuten. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 s'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const seconds = ms / 1000
  // Erst runden, dann zerlegen — sonst „60 s“ oder „1 min 60 s“.
  if (seconds < 59.95) return `${seconds.toLocaleString('de-DE', { maximumFractionDigits: 1 })} s`
  const gerundet = Math.round(seconds)
  return `${Math.floor(gerundet / 60)} min ${gerundet % 60} s`
}

/** Rate ohne überflüssige Nachkommastellen: 34 statt 34,0. */
export function formatRate(perSecond: number): string {
  if (!Number.isFinite(perSecond) || perSecond <= 0) return '0'
  return perSecond.toLocaleString('de-DE', { maximumFractionDigits: perSecond < 10 ? 1 : 0 })
}
