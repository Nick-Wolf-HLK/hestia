import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandbox, globMatches, LIMITS, truncate } from '../../src/main/agent/sandbox'

describe('Pfad-Sandbox', () => {
  let root: string
  let outside: string

  beforeEach(async () => {
    const base = await mkdtemp(join(tmpdir(), 'hearth-sb-'))
    root = join(base, 'arbeitsordner')
    outside = join(base, 'fremd')
    await mkdir(root, { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(join(root, 'notiz.txt'), 'hallo', 'utf8')
    await writeFile(join(outside, 'geheim.txt'), 'nicht fuer den agenten', 'utf8')
  })

  afterEach(async () => {
    // tmpdir kann selbst ein Symlink sein (macOS); die Wurzel real auflösen.
    const base = await realpath(root)
    await rm(join(base, '..'), { recursive: true, force: true })
  })

  it('lässt relative Pfade innerhalb der Wurzel zu', async () => {
    const sandbox = await createSandbox(root)
    await expect(sandbox.resolve('notiz.txt')).resolves.toContain('notiz.txt')
  })

  it('lehnt ".."-Ausstieg ab', async () => {
    const sandbox = await createSandbox(root)
    await expect(sandbox.resolve('../fremd/geheim.txt')).rejects.toThrow(/außerhalb/)
  })

  it('lehnt absolute Pfade außerhalb ab', async () => {
    const sandbox = await createSandbox(root)
    await expect(sandbox.resolve(join(outside, 'geheim.txt'))).rejects.toThrow(/außerhalb/)
  })

  it('lehnt Symlinks aus der Wurzel heraus ab', async () => {
    await symlink(join(outside, 'geheim.txt'), join(root, 'bruecke.txt'))
    const sandbox = await createSandbox(root)
    await expect(sandbox.resolve('bruecke.txt')).rejects.toThrow(/außerhalb/)
  })

  it('erlaubt Symlinks, die innerhalb der Wurzel bleiben', async () => {
    const ziel = join(root, 'notiz.txt')
    await symlink(ziel, join(root, 'verweis.txt'))
    const sandbox = await createSandbox(root)
    await expect(sandbox.resolve('verweis.txt')).resolves.toBe(await realpath(ziel))
  })

  it('meldet fehlende Arbeitsordner klar', async () => {
    await expect(createSandbox(join(root, 'gibt-es-nicht'))).rejects.toThrow(/existiert nicht/)
  })

  it('erkennt noch nicht vorhandene Zieldateien im erlaubten Bereich', async () => {
    const sandbox = await createSandbox(root)
    await expect(sandbox.resolve('neu/unterordner/datei.txt')).resolves.toContain('datei.txt')
  })
})

describe('Glob-Übersetzung', () => {
  it('**/ trifft alle Tiefen', () => {
    expect(globMatches('**/*.ts', 'a/b/c.ts')).toBe(true)
    expect(globMatches('**/*.ts', 'c.ts')).toBe(true)
    expect(globMatches('**/*.ts', 'a/b/c.tsx')).toBe(false)
  })

  it('* bleibt innerhalb eines Ordnerabschnitts', () => {
    expect(globMatches('*.md', 'README.md')).toBe(true)
    expect(globMatches('*.md', 'docs/README.md')).toBe(false)
  })

  it('escaped Sonderzeichen', () => {
    expect(globMatches('a+b.txt', 'a+b.txt')).toBe(true)
    expect(globMatches('axb.txt', 'a+b.txt')).toBe(false)
  })
})

describe('Grenzen', () => {
  it('kürzt lange Texte mit Hinweis', () => {
    const long = 'x'.repeat(LIMITS.maxOutputChars + 500)
    const short = truncate(long)
    expect(short.length).toBeLessThan(long.length)
    expect(short).toContain('abgekürzt')
  })

  it('lässt kurze Texte unangetastet', () => {
    expect(truncate('kurz')).toBe('kurz')
  })
})
