import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isAllowed, nextDocumentPath, registerFile, registerRoot } from '../../src/main/documents/registry'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'hestia-registry-'))
}

describe('Pfadliste für die Oberfläche', () => {
  it('lässt eine angemeldete Datei zu', async () => {
    const dir = await tempDir()
    const file = join(dir, 'erlaubt.md')
    await writeFile(file, 'x')
    registerFile(file)

    expect(await isAllowed(file)).toBe(true)
  })

  it('lässt Dateien unter einem angemeldeten Wurzelordner zu', async () => {
    const dir = await tempDir()
    const inner = join(dir, 'tiefer', 'drin')
    await mkdir(inner, { recursive: true })
    registerRoot(dir)

    expect(await isAllowed(join(inner, 'irgendwas.pdf'))).toBe(true)
  })

  it('weist Pfade außerhalb der Freigaben ab', async () => {
    const dir = await tempDir()
    registerRoot(dir)

    expect(await isAllowed('/etc/shadow')).toBe(false)
    expect(await isAllowed(join(tmpdir(), 'fremd', 'geheim.docx'))).toBe(false)
  })

  it('erzeugt saubere Dateinamen ohne verbotene Zeichen', () => {
    const path = nextDocumentPath('pdf', 'Entwurf/Q2: Ost–West', '/tmp/ziel')
    expect(path).toBe('/tmp/ziel/Entwurf-Q2- Ost–West.pdf')
  })

  it('hängt die passende Endung an', () => {
    expect(nextDocumentPath('markdown', 'Notiz').endsWith('.md')).toBe(true)
    expect(nextDocumentPath('docx', 'Notiz').endsWith('.docx')).toBe(true)
    expect(nextDocumentPath('pdf', 'Notiz').endsWith('.pdf')).toBe(true)
  })
})
