import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentRuntime, createDocumentRuntime, type AsksPermission } from '../../src/main/agent/tools'

/** Entscheidungs-Attrappe für Freigaben; zeichnet die Anfragen auf. */
function broker(allow: boolean): AsksPermission & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    async ask(request) {
      asked.push(`${request.kind}:${request.target}`)
      return allow
    }
  }
}

const MARKDOWN = '# Kurzfassung\n\n- Punkt\n- Punkt'

describe('create_document im Agenten', () => {
  let dir: string | undefined

  async function workspace(): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), 'hestia-agent-docs-'))
    return dir
  }

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('legt ein Word-Dokument im Arbeitsordner an, wenn freigegeben', async () => {
    const folder = await workspace()
    const permissions = broker(true)
    const runtime = createAgentRuntime({
      chatId: 'chat-1',
      folder,
      settings: { autoApproveWrites: false, allowCommands: false },
      permissions
    })

    const result = await runtime.execute('call-1', 'create_document', {
      title: 'Kurzfassung',
      format: 'docx',
      content: MARKDOWN
    })

    expect(result.ok).toBe(true)
    expect(result.document?.kind).toBe('docx')
    expect(result.document?.path).toBe(join(folder, 'Kurzfassung.docx'))
    expect((await stat(join(folder, 'Kurzfassung.docx'))).size).toBeGreaterThan(1000)
    expect(permissions.asked).toEqual(['write:Kurzfassung.docx'])
  })

  it('schreibt nichts, wenn die Freigabe verweigert wird', async () => {
    const folder = await workspace()
    const runtime = createAgentRuntime({
      chatId: 'chat-2',
      folder,
      settings: { autoApproveWrites: false, allowCommands: false },
      permissions: broker(false)
    })

    const result = await runtime.execute('call-1', 'create_document', {
      title: 'Verweigert',
      format: 'markdown',
      content: MARKDOWN
    })

    expect(result.ok).toBe(false)
    expect(result.document).toBeUndefined()
    await expect(readFile(join(folder, 'Verweigert.md'), 'utf8')).rejects.toBeTruthy()
  })

  it('lehnt ein unbekanntes Format ab', async () => {
    await workspace()
    const runtime = createDocumentRuntime({
      chatId: 'chat-3',
      settings: { autoApproveWrites: true, allowCommands: false },
      permissions: broker(true)
    })

    const result = await runtime.execute('call-1', 'create_document', {
      title: 'Falsch',
      format: 'rtf',
      content: MARKDOWN
    })

    expect(result.ok).toBe(false)
    expect(result.output).toContain('markdown, docx oder pdf')
  })

  it('lässt keinen Pfad aus dem Arbeitsordner heraus', async () => {
    const root = await workspace()
    const folder = join(root, 'arbeit')
    await mkdir(folder)

    const runtime = createAgentRuntime({
      chatId: 'chat-4',
      folder,
      settings: { autoApproveWrites: true, allowCommands: false },
      permissions: broker(true)
    })

    const result = await runtime.execute('call-1', 'create_document', {
      title: 'Ausbruch',
      format: 'markdown',
      content: MARKDOWN,
      path: '../../entkommen.md'
    })

    expect(result.ok).toBe(false)
    await expect(readFile(join(root, 'entkommen.md'), 'utf8')).rejects.toBeTruthy()
  })
})
