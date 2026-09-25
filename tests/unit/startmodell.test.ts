/**
 * Welches Modell ein neuer Chat bekommt: das zuletzt benutzte oder ein festes.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/types'
import { startModell } from '../../src/shared/startmodell'

const mit = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...patch })

describe('Modell beim Öffnen', () => {
  it('nimmt standardmäßig das zuletzt verwendete Modell', () => {
    expect(startModell(mit({ defaultModelChat: 'p|erstes', zuletztModell: 'p|zuletzt' }))).toBe('p|zuletzt')
    expect(startModell(mit({ defaultModelChat: 'p|erstes', zuletztModell: 'p|zuletzt' }), 'agent')).toBe('p|zuletzt')
  })

  it('fällt ohne bisherigen Lauf auf die Vorgabe zurück', () => {
    expect(startModell(mit({ defaultModelChat: 'p|erstes' }))).toBe('p|erstes')
  })

  it('bleibt bei „fest“ beim gewählten Modell, egal was zuletzt lief', () => {
    const s = mit({ modellBeimStart: 'fest', defaultModelChat: 'p|fest', defaultModelAgent: 'p|werk', zuletztModell: 'p|zuletzt' })
    expect(startModell(s)).toBe('p|fest')
    expect(startModell(s, 'agent')).toBe('p|werk')
  })

  it('liefert nichts, wenn es noch gar kein Modell gibt', () => {
    expect(startModell(mit({}))).toBeUndefined()
  })
})
