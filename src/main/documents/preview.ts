/**
 * Datei für die Vorschau lesbar machen.
 *
 * Grundsatz: Der Renderer sieht nie Pfade, die er selbst öffnet — er bekommt
 * Inhalte oder Bytes über diese Stelle, und die prüft Größe und Art.
 */
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type { PreviewKind, PreviewPayload } from '@shared/types'

const TEXT_SUFFIXES: Record<string, 'markdown' | 'text'> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
  '.csv': 'text',
  '.tsv': 'text',
  '.json': 'text',
  '.log': 'text',
  '.html': 'text',
  '.htm': 'text',
  '.ts': 'text',
  '.tsx': 'text',
  '.js': 'text',
  '.jsx': 'text',
  '.css': 'text',
  '.py': 'text',
  '.sh': 'text',
  '.yaml': 'text',
  '.yml': 'text',
  '.toml': 'text'
}

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp'
}

const MAX_TEXT_BYTES = 512_000
const MAX_BINARY_BYTES = 40_000_000

export function kindOf(path: string): PreviewKind {
  const suffix = extname(path).toLowerCase()
  if (TEXT_SUFFIXES[suffix]) return TEXT_SUFFIXES[suffix]!
  if (suffix === '.pdf') return 'pdf'
  if (suffix === '.docx') return 'docx'
  if (IMAGE_TYPES[suffix]) return 'image'
  return 'unsupported'
}

/** Liest die Datei für die Anzeige; zu große oder unbekannte Dateien werden abgewiesen. */
export async function previewFile(path: string): Promise<PreviewPayload> {
  const info = await stat(path).catch(() => undefined)
  if (!info?.isFile()) return { kind: 'unsupported', path, reason: 'Datei nicht gefunden' }

  const kind = kindOf(path)
  if (kind === 'unsupported') {
    return { kind: 'unsupported', path, reason: 'Für diesen Dateityp gibt es keine Vorschau' }
  }

  if (kind === 'markdown' || kind === 'text') {
    const content = await readFile(path)
    const text = content.subarray(0, MAX_TEXT_BYTES).toString('utf8')
    const truncated = content.byteLength > MAX_TEXT_BYTES
    return kind === 'markdown'
      ? { kind: 'markdown', path, text, truncated }
      : { kind: 'text', path, text, truncated }
  }

  if (info.size > MAX_BINARY_BYTES) {
    return { kind: 'unsupported', path, reason: 'Datei ist zu groß für die Vorschau' }
  }

  const bytes = await readFile(path)
  const base64 = bytes.toString('base64')

  if (kind === 'pdf') return { kind: 'pdf', path, base64, bytes: bytes.byteLength }
  if (kind === 'docx') return { kind: 'docx', path, base64, bytes: bytes.byteLength }

  const suffix = extname(path).toLowerCase()
  return { kind: 'image', path, base64, mediaType: IMAGE_TYPES[suffix] ?? 'application/octet-stream', bytes: bytes.byteLength }
}
