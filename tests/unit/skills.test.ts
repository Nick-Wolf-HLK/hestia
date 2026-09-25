import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mitSkills, skillAusgeloest, skillLesen, SkillStore, skillVerzeichnis } from '../../src/main/skills'

let wurzel: string
let store: SkillStore

beforeEach(async () => {
  wurzel = await mkdtemp(join(tmpdir(), 'skills-'))
  store = new SkillStore(join(wurzel, 'skills'))
})

afterEach(async () => {
  await rm(wurzel, { recursive: true, force: true })
})

describe('SKILL.md lesen', () => {
  it('trennt Kopf und Anleitung, auch mit Anführungszeichen', () => {
    const { kopf, rumpf } = skillLesen('---\nname: pptx\ndescription: "Für Folien, auch \\"Decks\\""\nlicense: x\n---\n\n# Anleitung\nTu das.')
    expect(kopf).toMatchObject({ name: 'pptx', description: 'Für Folien, auch "Decks"' })
    expect(rumpf).toBe('# Anleitung\nTu das.')
  })

  it('liest gefaltete Beschreibungen über mehrere Zeilen', () => {
    const { kopf } = skillLesen('---\nname: a\ndescription: >\n  erste Zeile\n  zweite Zeile\n---\nRumpf')
    expect(kopf.description).toBe('erste Zeile zweite Zeile')
  })

  it('nimmt eine Datei ohne Kopf ganz als Anleitung', () => {
    expect(skillLesen('nur Text')).toEqual({ kopf: {}, rumpf: 'nur Text' })
  })
})

describe('Skill-Ablage', () => {
  it('legt an, listet, schaltet aus und wieder an', async () => {
    await store.save({ name: 'wochenbericht', description: 'Für Wochenberichte', body: '1. Notizen lesen' })
    let [skill] = await store.list()
    expect(skill).toMatchObject({ name: 'wochenbericht', description: 'Für Wochenberichte', enabled: true })
    expect(skill!.body.trim()).toBe('1. Notizen lesen')

    await store.setEnabled('wochenbericht', false)
    expect(await store.aktive()).toHaveLength(0)
    ;[skill] = await store.list()
    expect(skill!.enabled).toBe(false)

    await store.setEnabled('wochenbericht', true)
    expect(await store.aktive()).toHaveLength(1)
  })

  it('schreibt das SKILL.md-Format', async () => {
    await store.save({ name: 'x', description: 'Beschreibung\nmit Umbruch', body: 'Anleitung' })
    const text = await readFile(join(wurzel, 'skills', 'x', 'SKILL.md'), 'utf8')
    expect(text).toBe('---\nname: x\ndescription: "Beschreibung mit Umbruch"\n---\n\nAnleitung\n')
  })

  it('weist ungültige Namen, Doppel und leere Felder ab', async () => {
    await expect(store.save({ name: 'Mit Leerzeichen', description: 'd', body: 'b' })).rejects.toThrow(/Kleinbuchstaben/)
    await expect(store.save({ name: 'ok', description: ' ', body: 'b' })).rejects.toThrow(/Beschreibung/)
    await store.save({ name: 'ok', description: 'd', body: 'b' })
    await expect(store.save({ name: 'ok', description: 'd', body: 'b' })).rejects.toThrow(/gibt es schon/)
  })

  it('benennt um und behält dabei den Aus-Zustand', async () => {
    await store.save({ name: 'alt', description: 'd', body: 'b' })
    await store.setEnabled('alt', false)
    await store.save({ name: 'neu', description: 'd2', body: 'b2', vorher: 'alt' })
    const liste = await store.list()
    expect(liste.map((s) => s.name)).toEqual(['neu'])
    expect(liste[0]).toMatchObject({ enabled: false, description: 'd2' })
  })

  it('übernimmt eine vorhandene Sammlung und überspringt Vorhandenes', async () => {
    const quelle = join(wurzel, 'sammlung', 'synced', 'abc')
    for (const name of ['pptx', 'morning']) {
      await mkdir(join(quelle, name), { recursive: true })
      await writeFile(join(quelle, name, 'SKILL.md'), `---\nname: ${name}\ndescription: zu ${name}\n---\nText`)
    }
    await store.save({ name: 'morning', description: 'schon da', body: 'b' })
    const ergebnis = await store.importieren(join(wurzel, 'sammlung', 'synced'))
    expect(ergebnis).toEqual({ neu: ['pptx'], uebersprungen: ['morning'] })
    expect((await store.get('morning'))!.description).toBe('schon da')
  })

  it('meldet einen Ordner ohne SKILL.md verständlich', async () => {
    await mkdir(join(wurzel, 'leer'))
    await expect(store.importieren(join(wurzel, 'leer'))).rejects.toThrow(/keine SKILL.md/)
  })
})

describe('Skills im Lauf', () => {
  const skill = { name: 'bericht', description: 'Für Berichte', body: 'Schritt 1', enabled: true, path: '/nirgends', updatedAt: 0 }

  it('nennt die Skills im Systemprompt, mit Hinweis aufs Werkzeug', () => {
    expect(skillVerzeichnis([], true)).toBe('')
    expect(skillVerzeichnis([skill], true)).toContain('- bericht: Für Berichte')
    expect(skillVerzeichnis([skill], true)).toContain('skill_laden')
    expect(skillVerzeichnis([skill], false)).not.toContain('skill_laden')
  })

  it('erkennt /name am Anfang, aber nicht mitten im Satz', () => {
    expect(skillAusgeloest('/bericht über Q3', [skill])?.name).toBe('bericht')
    expect(skillAusgeloest('  /bericht', [skill])?.name).toBe('bericht')
    expect(skillAusgeloest('bitte /bericht', [skill])).toBeUndefined()
    expect(skillAusgeloest('/unbekannt', [skill])).toBeUndefined()
  })

  it('legt skill_laden bei und reicht alles andere durch', async () => {
    const innen = {
      specs: [{ name: 'create_document', description: '', parameters: {} }],
      execute: async (_id: string, name: string) => ({ ok: true, output: `innen:${name}` })
    }
    const aussen = mitSkills(innen, [skill])!
    expect(aussen.specs.map((s) => s.name)).toEqual(['create_document', 'skill_laden'])
    expect(await aussen.execute('1', 'skill_laden', { name: 'bericht' })).toMatchObject({ ok: true, output: expect.stringContaining('Schritt 1') })
    expect(await aussen.execute('2', 'skill_laden', { name: 'fehlt' })).toMatchObject({ ok: false })
    expect(await aussen.execute('3', 'create_document', {})).toEqual({ ok: true, output: 'innen:create_document' })
  })

  it('ändert ohne aktive Skills nichts', () => {
    expect(mitSkills(undefined, [])).toBeUndefined()
  })
})
