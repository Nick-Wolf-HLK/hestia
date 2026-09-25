import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentRuntime, type AsksPermission } from '../../src/main/agent/tools'

interface AskLog {
  kind: string
  target: string
}

/** Rückfrage-Attrappe: zeichnet Anfragen auf und entscheidet vorgegeben. */
function fakeBroker(allow: boolean): { broker: AsksPermission; asks: AskLog[] } {
  const asks: AskLog[] = []
  return {
    asks,
    broker: {
      async ask(request) {
        asks.push({ kind: request.kind, target: request.target })
        return allow
      }
    }
  }
}

let base = ''
let folder = ''

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'hearth-agent-'))
  folder = join(base, 'projekt')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'notiz.txt'), 'apfel\nbanane\n', 'utf8')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

function runtime(options: { allow?: boolean; autoApprove?: boolean; allowCommands?: boolean } = {}) {
  const { broker, asks } = fakeBroker(options.allow ?? false)
  const rt = createAgentRuntime({
    chatId: 'chat-1',
    folder,
    settings: {
      autoApproveWrites: options.autoApprove ?? false,
      allowCommands: options.allowCommands ?? false
    },
    permissions: broker
  })
  return { rt, asks }
}

describe('Werkzeuglauf: Lesen', () => {
  it('listet den Arbeitsordner', async () => {
    const { rt } = runtime()
    const result = await rt.execute('c1', 'list_dir', { path: '' })
    expect(result.ok).toBe(true)
    expect(result.output).toContain('notiz.txt')
  })

  it('liest eine Datei', async () => {
    const { rt } = runtime()
    const result = await rt.execute('c1', 'read_file', { path: 'notiz.txt' })
    expect(result.output).toContain('apfel')
  })

  it('findet Textstellen mit Suchmuster', async () => {
    const { rt } = runtime()
    const result = await rt.execute('c1', 'search_files', { pattern: 'banane' })
    expect(result.output).toContain('notiz.txt:2')
  })
})

describe('Werkzeuglauf: Sandbox', () => {
  it('schreibt nicht außerhalb des Arbeitsordners', async () => {
    const { rt, asks } = runtime({ allow: true })
    const result = await rt.execute('c1', 'write_file', { path: '../evil.txt', content: 'x' })
    expect(result.ok).toBe(false)
    expect(result.output).toMatch(/außerhalb/)
    // Auch mit pauschaler Freigabe darf nichts außerhalb entstehen.
    expect(asks).toHaveLength(0)
    const escaped = await readFile(join(base, 'evil.txt'), 'utf8').catch(() => undefined)
    expect(escaped).toBeUndefined()
  })

  it('lehnt absolute Auswege ab', async () => {
    const { rt } = runtime({ allow: true })
    const result = await rt.execute('c1', 'write_file', { path: join(base, 'evil2.txt'), content: 'x' })
    expect(result.ok).toBe(false)
  })
})

describe('Werkzeuglauf: Rückfragen', () => {
  it('fragt vor dem Schreiben und unterlässt bei Ablehnung', async () => {
    const { rt, asks } = runtime({ allow: false })
    const result = await rt.execute('c1', 'write_file', { path: 'neu.txt', content: 'hallo' })
    expect(asks).toEqual([{ kind: 'write', target: 'neu.txt' }])
    expect(result.ok).toBe(false)
    const created = await readFile(join(folder, 'neu.txt'), 'utf8').catch(() => undefined)
    expect(created).toBeUndefined()
  })

  it('schreibt nach ausdrücklicher Erlaubnis', async () => {
    const { rt, asks } = runtime({ allow: true })
    const result = await rt.execute('c1', 'write_file', { path: 'neu.txt', content: 'hallo' })
    expect(result.ok).toBe(true)
    expect(asks).toHaveLength(1)
    expect(await readFile(join(folder, 'neu.txt'), 'utf8')).toBe('hallo')
  })

  it('fragt nicht, wenn Änderungen freigegeben sind', async () => {
    const { rt, asks } = runtime({ autoApprove: true })
    await rt.execute('c1', 'write_file', { path: 'ohne-frage.txt', content: 'j' })
    expect(asks).toHaveLength(0)
  })

  it('edit_file verlangt eine eindeutige Textstelle', async () => {
    const { rt } = runtime({ allow: true })
    const twice = await rt.execute('c1', 'edit_file', { path: 'notiz.txt', old_text: 'a', new_text: 'b' })
    expect(twice.ok).toBe(false)
    expect(twice.output).toMatch(/eindeutiger/)
  })
})

describe('Werkzeuglauf: Befehle', () => {
  it('bleibt zu, wenn Befehle ausgeschaltet sind', async () => {
    const { rt, asks } = runtime({ allowCommands: false, allow: true })
    const result = await rt.execute('c1', 'run_command', { command: 'echo', args: ['hi'] })
    expect(result.ok).toBe(false)
    expect(result.output).toMatch(/deaktiviert/)
    expect(asks).toHaveLength(0)
  })

  it('weist Shell-Metazeichen zurück', async () => {
    const { rt } = runtime({ allowCommands: true, allow: true })
    const result = await rt.execute('c1', 'run_command', { command: 'echo hi; rm -rf /' })
    expect(result.ok).toBe(false)
    expect(result.output).toMatch(/Metazeichen/)
  })

  // Freigegeben heißt: oberste Stufe **und** globale Erlaubnis. Dort verspricht
  // die Oberfläche „nichts fragen" — also fragt auch das Werkzeug nicht.
  it('führt freigegeben im Arbeitsordner aus, ohne zu fragen', async () => {
    const { rt, asks } = runtime({ allowCommands: true, allow: false })
    const result = await rt.execute('c1', 'run_command', { command: 'ls' })
    expect(asks).toHaveLength(0)
    expect(result.output).toContain('notiz.txt')
  })
})
