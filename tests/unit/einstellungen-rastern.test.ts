import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/types'
import { bekannteFelder } from '../../src/main/lib/raster'

describe('der Einrichtungsraster', () => {
  it('läßt bekannte Felder durch', () => {
    expect(bekannteFelder({ theme: 'dark' })).toEqual({ theme: 'dark' })
  })

  it('wirft Schlüssel weg, die es nicht gibt', () => {
    const Ergebnis = bekannteFelder({ theme: 'dark', composerMode: 'agent', altUndWeg: 1 })
    expect(Object.keys(Ergebnis)).toEqual(['theme'])
    expect(DEFAULT_SETTINGS).not.toHaveProperty('composerMode')
  })

  it('zerstört keine gültige Einrichtung', () => {
    expect(bekannteFelder({ ...DEFAULT_SETTINGS })).toEqual(DEFAULT_SETTINGS)
  })
})
