/**
 * Diktat: gesprochene Wörter in Text, auf dem eigenen Rechner.
 *
 * Bewusst **nicht mitgeliefert**. Ein Spracherkennungsmodell ist ein großes
 * Datenteil, das nicht in eine App gehört, und die Leute sollen selbst
 * entscheiden, welches. Dieses Modul findet, was schon da ist, und sagt sauber,
 * was fehlt.
 *
 * Drei Wege werden verstanden:
 *
 * - `whisper-cli` (whisper.cpp, GGUF-Modell) — der schnelle Weg ohne Python
 * - `whisper` (das Python-Programm) — nimmt Ordnernamen statt Dateiendung
 * - `parakeet` — für alle, die schon damit arbeiten
 *
 * Alles läuft über die Kommandozeile der Werkzeuge. Kein eigenes Abhören von
 * Modellformaten, kein Übersetzen von Binärdaten: dasTon- geht als Datei hinein
 * und der Text kommt als Text heraus.
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Motor {
  id: 'whisper-cpp' | 'whisper-python' | 'parakeet'
  name: string
  programm: string
  pfad: string | null
  modell: string
  bereit: boolean
  grund: string
  /** Der Befehl, der das Werkzeug beschafft. Nur ein Vorschlag zum Abtippen. */
  befehl: string
}

export interface DiktatStand {
  bereit: boolean
  motoren: Motor[]
  /** Ein Satz, was zu tun ist, wenn nichts bereit ist. */
  hinweis: string
}

const NAMEN: Array<{ id: Motor['id']; name: string; Programme: string[]; befehl: string }> = [
  {
    id: 'whisper-cpp',
    name: 'whisper.cpp',
    Programme: ['whisper-cli', 'whisper-cpp', 'main'],
    befehl: 'git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp && make'
  },
  { id: 'whisper-python', name: 'Whisper (Python)', Programme: ['whisper'], befehl: 'uv tool install openai-whisper' },
  { id: 'parakeet', name: 'Parakeet', Programme: ['parakeet'], befehl: 'uv tool install nemo-parakeet' }
]

/** Standardorte, an denen ein Modell meist liegt. */
function modellKandidaten(): string[] {
  const heim = homedir()
  return [
    join(heim, '.hestia', 'diktat'),
    join(heim, '.cache', 'whisper.cpp', 'models'),
    join(heim, 'whisper.cpp', 'models'),
    '/usr/share/models'
  ]
}

/** Das erste ausführbare Programm aus der Liste, oder null. */
async function sucheProgramm(namen: string[]): Promise<string | null> {
  const pfade = (process.env.PATH ?? '').split(':').filter(Boolean)
  for (const name of namen) {
    for (const ordner of pfade) {
      const kandidat = join(ordner, name)
      if (existsSync(kandidat)) return name
    }
  }
  return null
}

/** Ein passendes Modellverzeichnis oder -datei finden. */
function modellFinden(vorgegeben: string): { pfad: string; gefunden: boolean } {
  if (vorgegeben.trim()) return { pfad: vorgegeben.trim(), gefunden: existsSync(vorgegeben.trim()) }
  for (const ordner of modellKandidaten()) {
    if (!existsSync(ordner)) continue
    try {
      const dateien = readdirSync(ordner).filter((datei) => /\.(gguf|bin)$/i.test(datei))
      const erste = dateien[0]
      if (erste) return { pfad: join(ordner, erste), gefunden: true }
    } catch {
      /* nicht lesbar, weiter */
    }
  }
  return { pfad: '', gefunden: false }
}

/**
 * Was auf diesem Rechner diktiert werden könnte.
 *
 * Die Funktion lügt nicht: `bereit` ist nur dann wahr, wenn Programm **und**
 * Modell da sind. Der Grund sagt, was fehlt, damit die Oberfläche nichts
 * erraten muss.
 */
export async function standErmitteln(vorgaben: { programm?: string; modell?: string } = {}): Promise<DiktatStand> {
  const motoren: Motor[] = []
  const gesuchte = vorgaben.programm?.trim()
  for (const eintrag of NAMEN) {
    const programme = gesuchte ? [gesuchte] : eintrag.Programme
    const pfad = gesuchte ? (await sucheProgramm([gesuchte])) : await sucheProgramm(programme)
    const modell = modellFinden(vorgaben.modell ?? '')
    motoren.push({
      id: eintrag.id,
      name: eintrag.name,
      programm: programme[0] as string,
      pfad,
      modell: modell.pfad,
      bereit: !!pfad && modell.gefunden,
      grund: !pfad ? 'Programm nicht gefunden' : !modell.gefunden ? 'Kein Modell gefunden' : '',
      befehl: eintrag.befehl
    })
  }
  const bereit = motoren.some((motor) => motor.bereit)
  return {
    bereit,
    motoren,
    hinweis: bereit
      ? ''
      : 'Für Diktat fehlt ein Erkennungsprogramm. Eines installieren und Hestia neu prüfen lassen.'
  }
}

/** Die Argumente, die jedes Werkzeug braucht. */
export function befehlFuer(denMotor: Motor, audioPfad: string, sprache: string): { programm: string; folge: string[] } {
  if (denMotor.id === 'whisper-cpp') {
    return { programm: denMotor.programm, folge: ['-m', denMotor.modell, '-f', audioPfad, '-l', sprache, '-nt', '-np'] }
  }
  if (denMotor.id === 'whisper-python') {
    return {
      programm: denMotor.programm,
      folge: [audioPfad, '--language', sprache, '--fp16', 'False', '--output_format', 'txt', '--output_dir', '/tmp']
    }
  }
  return { programm: denMotor.programm, folge: [audioPfad, '--language', sprache] }
}

function laufen(programm: string, folge: string[], signal?: AbortSignal): Promise<{ code: number; ausgabe: string }> {
  return new Promise((resolve, reject) => {
    const kind = spawn(programm, folge, { signal })
    let ausgabe = ''
    kind.stdout?.on('data', (brocken: Buffer) => (ausgabe += brocken.toString()))
    kind.stderr?.on('data', (brocken: Buffer) => (ausgabe += brocken.toString()))
    kind.on('error', (fehler) => reject(new Error(`„${programm}" ließ sich nicht starten: ${fehler.message}`)))
    kind.on('close', (code) => resolve({ code: code ?? -1, ausgabe }))
  })
}

/**
 * Die Zeitstempelzeilen von whisper.cpp abschereln (`[00:00:00.000 --> …]`)
 * und Leerzeilen glätten. Was übrig bleibt, ist der diktierte Text.
 */
export function textAusGabe(ausgabe: string): string {
  return ausgabe
    .split('\n')
    .map((zeile) => zeile.replace(/^\s*\[[0-9:.]+\s*-->\s*[0-9:.]+\]\s*/, '').trim())
    .filter((zeile) => zeile.length > 0)
    .join(' ')
    .trim()
}

/**
 * Eine Audiodatei in Text verwandeln.
 *
 * Die Datei bleibt, bis die Oberfläche sie wegwirft; das Werkzeug schreibt
 * nichts zurück. Fehler kommen als Meldung zurück, die ein Mensch versteht —
 * die Ausgabe des Werkzeugs steht dahinter, nicht davor.
 */
export async function abschreiben(
  audioPfad: string,
  opts: { sprache?: string; programm?: string; modell?: string; signal?: AbortSignal } = {}
): Promise<{ text: string; motor: string }> {
  const stand = await standErmitteln({ programm: opts.programm, modell: opts.modell })
  const motor = stand.motoren.find((einer) => einer.bereit)
  if (!motor) throw new Error(stand.motoren.map((einer) => `${einer.name}: ${einer.grund}`).join(' — ') || 'Kein Diktatwerkzeug')
  const { programm, folge } = befehlFuer(motor, audioPfad, opts.sprache ?? 'de')
  const ergebnis = await laufen(programm, folge, opts.signal)
  const text = textAusGabe(ergebnis.ausgabe)
  if (ergebnis.code !== 0 && !text) {
    throw new Error(`Das Erkennungsprogramm meldet Fehler ${ergebnis.code}: ${ergebnis.ausgabe.slice(-400)}`)
  }
  if (!text) throw new Error('Nichts verstanden.')
  return { text, motor: motor.name }
}
