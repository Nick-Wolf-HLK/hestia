/**
 * Skills: wiederverwendbare Anleitungen, die das Modell bei Bedarf selbst lädt.
 *
 * Das Format ist das offene SKILL.md-Format — ein Ordner je Skill mit einer `SKILL.md`,
 * oben ein Kopf mit `name` und `description`, darunter die Anleitung. So lassen
 * sich vorhandene Skills einfach herüberkopieren, und was hier entsteht, taugt
 * auch dort.
 *
 * Das Modell sieht zunächst nur Name und Beschreibung aller aktiven Skills.
 * Passt einer, lädt es die Anleitung über das Werkzeug `skill_laden` — erst
 * dann kostet sie Kontext. Wer einen Skill gezielt will, schreibt `/name`
 * an den Anfang der Nachricht; dann steht die Anleitung von vornherein da.
 */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Skill } from '@shared/types'
import type { ToolRuntime } from './chat'
import type { ToolSpec } from './providers/types'

const DATEI = 'SKILL.md'
/** Kleinbuchstaben, Ziffern, Bindestriche. */
export const NAMENSREGEL = /^[a-z0-9][a-z0-9-]{0,63}$/

export interface SkillKopf {
  name?: string
  description?: string
}

/** Kopf und Rumpf einer SKILL.md trennen; einfache YAML-Lesart genügt. */
export function skillLesen(text: string): { kopf: SkillKopf; rumpf: string } {
  const treffer = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!treffer) return { kopf: {}, rumpf: text }
  const kopf: Record<string, string> = {}
  const zeilen = treffer[1]!.split(/\r?\n/)
  for (let i = 0; i < zeilen.length; i++) {
    const zeile = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(zeilen[i]!)
    if (!zeile) continue
    let wert = zeile[2]!.trim()
    // Block-Schreibweise (`>` oder `|`): eingerückte Folgezeilen gehören dazu.
    if (wert === '>' || wert === '|' || wert === '>-' || wert === '|-') {
      const teile: string[] = []
      while (i + 1 < zeilen.length && /^\s+\S/.test(zeilen[i + 1]!)) teile.push(zeilen[++i]!.trim())
      wert = teile.join(wert.startsWith('>') ? ' ' : '\n')
    } else if ((wert.startsWith('"') && wert.endsWith('"')) || (wert.startsWith("'") && wert.endsWith("'"))) {
      wert = wert.slice(1, -1).replace(/\\"/g, '"')
    }
    kopf[zeile[1]!] = wert
  }
  return { kopf, rumpf: treffer[2]!.replace(/^\s*\n/, '') }
}

export function skillSchreiben(name: string, beschreibung: string, anleitung: string): string {
  const eine = beschreibung.replace(/\s+/g, ' ').trim()
  return `---\nname: ${name}\ndescription: ${JSON.stringify(eine)}\n---\n\n${anleitung.trim()}\n`
}

export class SkillStore {
  private zustandsdatei: string

  constructor(readonly ordner: string) {
    this.zustandsdatei = join(ordner, '.zustand.json')
  }

  private aus(): Set<string> {
    try {
      const daten = JSON.parse(readFileSync(this.zustandsdatei, 'utf8')) as { aus?: string[] }
      return new Set(daten.aus ?? [])
    } catch {
      return new Set()
    }
  }

  private ausSetzen(menge: Set<string>): void {
    writeFileSync(this.zustandsdatei, JSON.stringify({ aus: [...menge].sort() }, null, 2))
  }

  async list(): Promise<Skill[]> {
    await mkdir(this.ordner, { recursive: true })
    const aus = this.aus()
    const eintraege = await readdir(this.ordner, { withFileTypes: true })
    const skills: Skill[] = []
    for (const eintrag of eintraege) {
      if (!eintrag.isDirectory() || eintrag.name.startsWith('.')) continue
      const pfad = join(this.ordner, eintrag.name, DATEI)
      const text = await readFile(pfad, 'utf8').catch(() => undefined)
      if (text === undefined) continue
      const { kopf, rumpf } = skillLesen(text)
      const info = await stat(pfad)
      skills.push({
        name: eintrag.name,
        description: kopf.description ?? '',
        body: rumpf,
        enabled: !aus.has(eintrag.name),
        path: join(this.ordner, eintrag.name),
        updatedAt: info.mtimeMs
      })
    }
    return skills.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async aktive(): Promise<Skill[]> {
    return (await this.list()).filter((skill) => skill.enabled)
  }

  async get(name: string): Promise<Skill | undefined> {
    return (await this.list()).find((skill) => skill.name === name)
  }

  /** Anlegen oder ändern; `vorher` erlaubt das Umbenennen. */
  async save(eingabe: { name: string; description: string; body: string; vorher?: string }): Promise<Skill> {
    const name = eingabe.name.trim()
    if (!NAMENSREGEL.test(name)) {
      throw new Error('Der Name darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten, zum Beispiel „wochenbericht“.')
    }
    if (!eingabe.description.trim()) throw new Error('Die Beschreibung fehlt — an ihr erkennt das Modell, wann der Skill passt.')
    if (!eingabe.body.trim()) throw new Error('Die Anleitung ist leer.')
    // Der alte Name kommt von außen (auch über den Fernzugang) und landet in
    // cp/rm — er muss derselben Regel genügen, sonst wanderte „../../Dokumente“
    // samt Löschung aus dem Skill-Ordner hinaus.
    if (eingabe.vorher !== undefined && !NAMENSREGEL.test(eingabe.vorher)) throw new Error('Ungültiger bisheriger Name.')
    const ziel = join(this.ordner, name)
    const umbenannt = eingabe.vorher && eingabe.vorher !== name
    if ((umbenannt || !eingabe.vorher) && existsSync(ziel)) throw new Error(`Einen Skill „${name}“ gibt es schon.`)
    if (umbenannt) {
      const alt = join(this.ordner, eingabe.vorher!)
      await cp(alt, ziel, { recursive: true })
      await rm(alt, { recursive: true, force: true })
      const aus = this.aus()
      if (aus.delete(eingabe.vorher!)) {
        aus.add(name)
        this.ausSetzen(aus)
      }
    }
    await mkdir(ziel, { recursive: true })
    await writeFile(join(ziel, DATEI), skillSchreiben(name, eingabe.description, eingabe.body), 'utf8')
    return (await this.get(name))!
  }

  async remove(name: string): Promise<void> {
    if (!NAMENSREGEL.test(name)) return
    await rm(join(this.ordner, name), { recursive: true, force: true })
    const aus = this.aus()
    if (aus.delete(name)) this.ausSetzen(aus)
  }

  async setEnabled(name: string, an: boolean): Promise<void> {
    const aus = this.aus()
    if (an) aus.delete(name)
    else aus.add(name)
    this.ausSetzen(aus)
  }

  /**
   * Einen Ordner übernehmen: entweder selbst ein Skill (enthält `SKILL.md`)
   * oder eine Sammlung davon, bis zwei Ebenen tief. Bestehende Namen werden
   * nicht überschrieben, sondern gemeldet.
   */
  async importieren(quelle: string): Promise<{ neu: string[]; uebersprungen: string[] }> {
    await mkdir(this.ordner, { recursive: true })
    const funde: string[] = []
    const suchen = async (ordner: string, tiefe: number): Promise<void> => {
      if (existsSync(join(ordner, DATEI))) {
        funde.push(ordner)
        return
      }
      if (tiefe >= 2) return
      const eintraege = await readdir(ordner, { withFileTypes: true }).catch(() => [])
      for (const eintrag of eintraege) {
        if (eintrag.isDirectory() && !eintrag.name.startsWith('.')) await suchen(join(ordner, eintrag.name), tiefe + 1)
      }
    }
    await suchen(quelle, 0)
    if (funde.length === 0) throw new Error('In diesem Ordner liegt keine SKILL.md — weder direkt noch in Unterordnern.')

    const neu: string[] = []
    const uebersprungen: string[] = []
    for (const fund of funde) {
      const { kopf } = skillLesen(await readFile(join(fund, DATEI), 'utf8'))
      const roh = (kopf.name ?? basename(fund)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
      const name = roh.slice(0, 64)
      if (!NAMENSREGEL.test(name) || existsSync(join(this.ordner, name))) {
        uebersprungen.push(name || basename(fund))
        continue
      }
      await cp(fund, join(this.ordner, name), { recursive: true })
      neu.push(name)
    }
    return { neu, uebersprungen }
  }
}

/** Die Zeilen für den Systemprompt: welche Skills es gibt und wie man sie holt. */
export function skillVerzeichnis(skills: Skill[], mitWerkzeug: boolean): string {
  if (skills.length === 0) return ''
  const liste = skills.map((skill) => `- ${skill.name}: ${skill.description.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n')
  return mitWerkzeug
    ? `Verfügbare Skills (Anleitungen der Nutzer:in):\n${liste}\n\nPasst einer zur Aufgabe, lade ihn zuerst mit dem Werkzeug skill_laden und folge seiner Anleitung.`
    : `Verfügbare Skills (Anleitungen der Nutzer:in):\n${liste}`
}

/** Die volle Anleitung, wenn jemand `/name` an den Anfang geschrieben hat. */
export function skillAusgeloest(text: string, skills: Skill[]): Skill | undefined {
  const treffer = /^\/([a-z0-9][a-z0-9-]*)(?:\s|$)/.exec(text.trimStart())
  if (!treffer) return undefined
  return skills.find((skill) => skill.name === treffer[1])
}

const SPEZ: ToolSpec = {
  name: 'skill_laden',
  description: 'Lädt die vollständige Anleitung eines Skills aus der Liste im Systemprompt. Vor der Arbeit aufrufen, wenn ein Skill passt.',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Name des Skills, genau wie in der Liste' } },
    required: ['name'],
    additionalProperties: false
  }
}

/** Ein Werkzeugkasten, dem `skill_laden` beigelegt ist (oder einer nur damit). */
export function mitSkills(runtime: ToolRuntime | undefined, skills: Skill[]): ToolRuntime | undefined {
  if (skills.length === 0) return runtime
  const laden = async (name: string): Promise<{ ok: boolean; output: string }> => {
    const skill = skills.find((kandidat) => kandidat.name === name.trim())
    if (!skill) return { ok: false, output: `Keinen aktiven Skill „${name}“ gefunden. Vorhanden: ${skills.map((s) => s.name).join(', ')}` }
    const weitere = await readdir(skill.path).catch(() => [] as string[])
    const beilagen = weitere.filter((datei) => datei !== DATEI && !datei.startsWith('.'))
    return {
      ok: true,
      output: `# Skill ${skill.name}\n\n${skill.body}${beilagen.length ? `\n\n(Weitere Dateien im Skill-Ordner ${skill.path}: ${beilagen.join(', ')})` : ''}`
    }
  }
  return {
    specs: [...(runtime?.specs ?? []), SPEZ],
    maxSteps: runtime?.maxSteps,
    async execute(callId, name, args) {
      if (name === SPEZ.name) return laden(String((args as { name?: unknown } | undefined)?.name ?? ''))
      if (!runtime) return { ok: false, output: `Unbekanntes Werkzeug: ${name}` }
      return runtime.execute(callId, name, args)
    }
  }
}
