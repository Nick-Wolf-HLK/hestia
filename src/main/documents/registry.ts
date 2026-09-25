/**
 * Pfade, die der Renderer sehen darf.
 *
 * Der Renderer öffnet niemals eigenmächtig Dateipfade: jede Bahn, die ihm
 * angezeigt wird, wird hier hinterlegt, und Öffnen/Enthüllen/Vorschau lassen
 * nur hinterlegte Pfade oder die eigenen Ablageordner zu.
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join, resolve } from 'node:path'

/** Zusätzlich zu hinterlegten Dateien erlaubte Wurzelordner. */
const roots = new Set<string>()
/** Von Hand hinterlegte Dateien (z. B. aus Antworten des Agenten). */
const allowed = new Set<string>()

/**
 * Ablage für Dokumente ohne gewählten Arbeitsordner. Der Electron-Pfad ist die
 * Regel; die Fallbacks halten die Funktion auch außerhalb des Hauptprozesses
 * nutzbar (Tests) und verhindern, dass ein fehlender Ordner den Start abbricht.
 */
export function documentsDir(): string {
  // Für Prüfläufe: ein eigener Ordner, damit Testdokumente nicht zwischen den
  // echten landen.
  if (process.env['HESTIA_DOKUMENTE']) return process.env['HESTIA_DOKUMENTE']
  try {
    return join(app.getPath('documents'), 'Hestia')
  } catch {
    return join(homedir(), 'Dokumente', 'Hestia')
  }
}

export function registerRoot(path: string | undefined): void {
  if (!path) return
  roots.add(resolve(path))
}

export function registerFile(path: string): void {
  allowed.add(resolve(path))
}

export function knownRoots(): string[] {
  return [documentsDir(), join(homedir(), '.config', 'hestiadesk'), ...roots]
}

/** Pfad liegt unter einer erlaubten Wurzel (Symlinks werden aufgelöst). */
async function underRoot(path: string): Promise<boolean> {
  const real = await realpath(path).catch(() => resolve(path))
  for (const root of knownRoots()) {
    const realRoot = await realpath(root).catch(() => resolve(root))
    if (real === realRoot || real.startsWith(realRoot + '/')) return true
  }
  return false
}

export async function isAllowed(path: string): Promise<boolean> {
  const target = resolve(path)
  if (allowed.has(target)) return true
  // Der echte Pfad der Datei selbst muss unter einer Wurzel liegen — nicht nur
  // ihr Ordner: Ein Symlink in einem erlaubten Ordner zeigte sonst auf jede
  // beliebige Datei (auch über den Fernzugang).
  return underRoot(target)
}

/** Wirft, wenn der Pfad nicht geöffnet werden darf. */
export async function assertAllowed(path: string): Promise<string> {
  if (!(await isAllowed(path))) throw new Error('Zugriff auf diesen Pfad ist nicht freigegeben')
  return resolve(path)
}

/** Freier Zielpfad für ein neues Dokument. */
export function nextDocumentPath(kind: 'markdown' | 'docx' | 'pdf', title: string, folder?: string): string {
  const suffix = kind === 'markdown' ? '.md' : kind === 'docx' ? '.docx' : '.pdf'
  const base = (title || 'dokument')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
  const dir = folder ?? documentsDir()
  return freierPfad(join(dir, `${base}${suffix}`))
}

/**
 * Ein Pfad, unter dem noch nichts liegt: „Anschreiben.pdf“, sonst
 * „Anschreiben (2).pdf“ usw. Ein neues Dokument überschreibt nie ein anderes —
 * ändern geht über dokument_bearbeiten.
 */
export function freierPfad(pfad: string): string {
  if (!existsSync(pfad)) return pfad
  const endung = extname(pfad)
  const stamm = pfad.slice(0, pfad.length - endung.length)
  for (let n = 2; n < 1000; n++) {
    const kandidat = `${stamm} (${n})${endung}`
    if (!existsSync(kandidat)) return kandidat
  }
  return `${stamm} (${Date.now()})${endung}`
}
