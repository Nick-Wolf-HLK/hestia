import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseInline, parseMarkdown, renderHtmlDocument } from '../../src/main/documents/markdown'
import { kindOf } from '../../src/main/documents/preview'
import { createDocument } from '../../src/main/documents/create'

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'hestia-docs-'))
}

describe('Markdown-Blöcke', () => {
  it('erkennt Überschriften, Listen, Tabellen und Code', () => {
    const blocks = parseMarkdown(
      ['# Titel', '', 'Ein Absatz mit **fett** und `Code`.', '', '- eins', '- zwei', '', '1. zuerst', '2. danach', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', '', '```ts', 'const x = 1', '```'].join('\n')
    )

    expect(blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'bullets',
      'numbered',
      'table',
      'code'
    ])
  })

  it('übersetzt Inline-Auszeichnung sauber', () => {
    const parts = parseInline('Normal **fett** *kursiv* `code`')
    expect(parts).toEqual(
      expect.arrayContaining([
        { text: 'Normal ' },
        { text: 'fett', bold: true },
        { text: 'kursiv', italic: true },
        { text: 'code', code: true }
      ])
    )
  })

  it('escaped HTML im Druckdokument (kein Roheinschleusen)', () => {
    const html = renderHtmlDocument('Test', parseMarkdown('<img src=x onerror=alert(1)>'))
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('hält Umlaute im Druckdokument', () => {
    const html = renderHtmlDocument('Übersicht', parseMarkdown('Ärger mit Ö und Ü — ¼'))
    expect(html).toContain('Ärger mit Ö und Ü')
    expect(html).toContain('<meta charset="utf-8">')
  })
})

describe('Vorschau-Arten', () => {
  it('ordnet Endungen den Typen zu', () => {
    expect(kindOf('/tmp/a.md')).toBe('markdown')
    expect(kindOf('/tmp/a.pdf')).toBe('pdf')
    expect(kindOf('/tmp/a.DOCX')).toBe('docx')
    expect(kindOf('/tmp/a.png')).toBe('image')
    expect(kindOf('/tmp/a.zip')).toBe('unsupported')
  })
})

describe('Dokumente erzeugen', () => {
  it('schreibt Markdown als Textdatei', async () => {
    const dir = await tempDir()
    const target = join(dir, 'notiz.md')
    const result = await createDocument({ kind: 'markdown', path: target, markdown: '# Notiz\n\nText' })

    expect(result.bytes).toBeGreaterThan(0)
    expect(await readFile(target, 'utf8')).toBe('# Notiz\n\nText\n')
    await rm(dir, { recursive: true, force: true })
  })

  it('schreibt eine gültige .docx (ZIP mit Dokumentteil)', async () => {
    const dir = await tempDir()
    const target = join(dir, 'bericht.docx')
    const result = await createDocument({
      kind: 'docx',
      path: target,
      title: 'Bericht',
      markdown: ['# Zwischenstand', '', '- Punkt eins', '- Punkt zwei', '', '| Spalte | Wert |', '| --- | --- |', '| A | 1 |'].join('\n')
    })

    const bytes = await readFile(target)
    // Signatur eines ZIP-Archivs und der Kern eines Word-Dokuments.
    expect(bytes.subarray(0, 2).toString('ascii')).toBe('PK')
    expect(result.bytes).toBeGreaterThan(1000)
    expect(await hasEntry(bytes, 'word/document.xml')).toBe(true)
    await rm(dir, { recursive: true, force: true })
  })
})

/** Kleiner ZIP-Leser nur für den Test: Namen der Einträge finden. */
async function hasEntry(zip: Buffer, wanted: string): Promise<boolean> {
  let offset = 0
  while (offset < zip.length - 4) {
    if (zip.readUInt32LE(offset) !== 0x04034b50) {
      offset++
      continue
    }
    const nameLength = zip.readUInt16LE(offset + 26)
    const extraLength = zip.readUInt16LE(offset + 28)
    const compressedSize = zip.readUInt32LE(offset + 18)
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    if (name === wanted) return true
    offset += 30 + nameLength + extraLength + compressedSize
  }
  return false
}
