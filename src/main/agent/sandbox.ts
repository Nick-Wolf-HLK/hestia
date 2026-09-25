/**
 * Pfad-Sandbox: jeder Dateizugriff des Agenten wird gegen die erlaubte
 * Arbeitswurzel geprüft. Symlinks, ".." und absolute Auswege scheitern.
 */
import { realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export class SandboxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SandboxError'
  }
}

export interface Sandbox {
  root: string
  resolve(relativeOrAbsolute: string): Promise<string>
  assertInside(absolute: string): Promise<string>
}

export async function createSandbox(rootPath: string): Promise<Sandbox> {
  let root: string
  try {
    root = await realpath(rootPath)
  } catch {
    throw new SandboxError(`Arbeitsordner existiert nicht: ${rootPath}`)
  }
  const info = await stat(root).catch(() => undefined)
  if (!info?.isDirectory()) throw new SandboxError('Der angegebene Pfad ist kein Ordner')

  const inside = (target: string): boolean => {
    const rel = relative(root, target)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  }

  /**
   * Wandelt einen Eingabepfad in einen echten Pfad innerhalb der Wurzel um.
   * Bei nicht existierenden Zielen wird der nächstliegende existierende
   * Elternordner real aufgelöst, damit Symlinks trotzdem erkannt werden.
   */
  async function assertInside(absolute: string): Promise<string> {
    let candidate = absolute
    const missing: string[] = []
    for (;;) {
      try {
        const real = await realpath(candidate)
        if (!inside(real)) throw new SandboxError(`Zugriff außerhalb des Arbeitsordners: ${absolute}`)
        return missing.length > 0 ? resolve(real, ...missing.reverse()) : real
      } catch (e) {
        if (e instanceof SandboxError) throw e
        missing.push(candidate.split(sep).pop() ?? '')
        const parent = dirname(candidate)
        if (parent === candidate) throw new SandboxError(`Pfad nicht erreichbar: ${absolute}`)
        candidate = parent
      }
    }
  }

  return {
    root,
    async resolve(input: string): Promise<string> {
      if (typeof input !== 'string' || input.length === 0) throw new SandboxError('Leerer Pfad')
      const absolute = isAbsolute(input) ? resolve(input) : resolve(root, input)
      return assertInside(absolute)
    },
    assertInside
  }
}

/** Glob → RegExp: "**" über Ordner hinweg, "*" innerhalb eines Abschnitts. */
export function globMatches(glob: string, relPath: string): boolean {
  const DOUBLE = '__d0uble__'
  const escaped = glob.replace(/[.+^${}()|[\]\\?]/g, '\\$&')
  const source = escaped
    .replace(/\*\*\//g, DOUBLE)
    .replace(/\*\*/g, 'ÄNZ')
    .replace(/\*/g, '[^/]*')
    .replace(new RegExp(DOUBLE, 'g'), '(?:.*/)?')
    .replace(/ÄNZ/g, '.*')
  try {
    return new RegExp(`^${source}$`).test(relPath)
  } catch {
    return false
  }
}

/** Begrenzungen, damit ein Modell neither die Platte flutet noch den Speicher sprengt. */
export const LIMITS = {
  maxReadBytes: 2_000_000,
  maxWriteBytes: 1_500_000,
  maxListEntries: 400,
  maxSearchResults: 80,
  maxOutputChars: 24_000,
  maxCommandMs: 60_000
}

export function truncate(text: string, max = LIMITS.maxOutputChars): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n… (abgekürzt, ${text.length - max} Zeichen nicht angezeigt)`
}
