/**
 * Knöpfe ohne Wirkung — zwei Klassen, still gemessen.
 *
 * 1. **Ein gespeicherter Wunsch ohne Ausführung.** Ein Feld wandert durch die
 *    Einrichtung, die Oberfläche zeigt es an, und sonst liest es niemand. So
 *    begann `keepAwake`: zwei Jahre lang ein Haken auf Papier.
 * 2. **Ein Weg, den es nicht gibt.** Die Oberfläche im Browser spricht über
 *    feste Adressen mit dem Fernzugang. Ein Tippfehler dort ist eine Funktion,
 *    die am Rechner geht und im Browser still nichts tut.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/types'
import { NUR_AM_RECHNER } from '../../src/main/fern'

function quellen(verzeichnis: string, out: string[] = []): string[] {
  for (const eintrag of readdirSync(verzeichnis)) {
    if (eintrag === 'node_modules' || eintrag.startsWith('.')) continue
    const pfad = `${verzeichnis}/${eintrag}`
    const wert = statSync(pfad)
    if (wert.isDirectory()) quellen(pfad, out)
    else if (/\.tsx?$/.test(pfad)) out.push(readFileSync(pfad, 'utf8'))
  }
  return out
}

describe('die Wirkung', () => {
  it('liest jede Einstellung auch jemand — gespeichert allein genügt nicht', () => {
    // Alles außerhalb der reinen Verträge: dort wird gespeichert, nicht genutzt.
    // Die Vorgabeliste selbst zählt nicht als Benutzung — der übrige Code schon,
// denn dort steht sowohl die Prüfung als auch das eigentliche Lesen.
const texts = quellen('src').filter((text) => !text.includes('DEFAULT_SETTINGS: Settings = {'))
    const zusammen = texts.join('\n')
    const wirkungslos: string[] = []
    for (const feld of Object.keys(DEFAULT_SETTINGS)) {
      // Gelesen wird über `settings.feld`, `patch.feld`, `input.feld` oder
      // `s.settings.feld` — und in der Brücke über den Namen als Schlüssel.
      const gelesen = new RegExp(`\\b(?:settings|patch|input|next|vorher|einstellungen)(?:\\.get\\(\\))?\\s*\\.\\s*${feld}\\b`).test(zusammen)
      const gesendet = new RegExp(`\\{\\s*${feld}\\s*[,:}]`).test(zusammen) || new RegExp(`${feld}:\\s*`).test(zusammen)
      if (!gelesen || !gesendet) wirkungslos.push(`${feld} (gelesen:${gelesen} gesendet:${gesendet})`)
    }
    expect(wirkungslos, `ohne nachweisbare Ausführung: ${wirkungslos.join(', ')}`).toEqual([])
  })

  it('ruft im Browser nur Wege auf, die der Fernzugang kennt', () => {
    const bruecke = readFileSync('src/renderer/src/lib/fern.ts', 'utf8')
    const zugang = readFileSync('src/main/mobile/server.ts', 'utf8')
    const gerufen = new Set<string>()
    for (const treffer of bruecke.matchAll(/[`'](\/api\/[a-z]+)/g)) gerufen.add(treffer[1] as string)
    expect([...gerufen].sort()).toEqual(['/api/datei', '/api/ereignisse', '/api/rpc', '/api/senden'])
    for (const pfad of gerufen) expect(zugang, `der Browser ruft ${pfad}, der Zugang kennt es nicht`).toContain(`'${pfad}'`)
  })

  it('ersetzt der Browser jeden Kanal selbst, den der Zugang sperrt', () => {
    // Sonst gäbe es im Browser einen Knopf, der nur „geht nur am Rechner" meldet,
    // obwohl es einen Ersatz (Download, eigene Eingabe) hätte geben können.
    const bruecke = readFileSync('src/renderer/src/lib/fern.ts', 'utf8')
    const ersetzt = ['win:', 'folder:pick', 'shell:reveal', 'shell:copy-text', 'skills:import', 'skills:reveal', 'documents:open', 'documents:reveal', 'documents:save-as', 'artifacts:export', 'mobile:stop', 'mobile:new-code', 'providers:save', 'providers:delete']
    for (const kanal of NUR_AM_RECHNER) expect(ersetzt.some((e) => kanal.startsWith(e)), kanal).toBe(true)
    // Anbieter: im Browser nur lesbar — die Einstellungen zeigen dort einen Hinweis statt der Felder.
    expect(readFileSync('src/renderer/src/features/settings/SettingsModal.tsx', 'utf8')).toContain("t('settings.providersRemote')")
    for (const teil of ['win:', 'pickFolder', 'reveal:', 'copy:', 'importFolder', 'open:', 'saveAs', 'export:']) {
      expect(bruecke.includes(teil.replace(':', '')) || bruecke.includes(teil), teil).toBe(true)
    }
  })
})
