import { describe, expect, it } from 'vitest'
import { repariereArgs, repariereText } from '../../src/main/providers/zeichen'

describe('repariereText', () => {
  it('repariert doppelt kodierte Umlaute', () => {
    expect(repariereText('Der bÃ¶rige BÃ¤r')).toBe('Der börige Bär')
    expect(repariereText('groÃŸen grÃ¼nen')).toBe('großen grünen')
    expect(repariereText('KÃ©rner')).toBe('Kérner')
  })

  it('lässt korrekten Text unverändert', () => {
    for (const t of ['Der mürrische Bär', 'Straße', 'Ärger über Öl', 'Café', 'plain ascii', '„Zitat“ – €5', '🐻 Bär']) {
      expect(repariereText(t)).toBe(t)
    }
  })

  it('lässt gemischten Text unverändert, der kein gültiges UTF-8 ergibt', () => {
    expect(repariereText('Ã¤ und ä')).toBe('Ã¤ und ä')
  })
})

describe('repariereArgs', () => {
  it('geht durch verschachtelte Argumente', () => {
    expect(
      repariereArgs({ title: 'BÃ¤r', format: 'pdf', teile: ['grÃ¼n', 3], gestaltung: { vorlage: 'klassisch' } })
    ).toEqual({ title: 'Bär', format: 'pdf', teile: ['grün', 3], gestaltung: { vorlage: 'klassisch' } })
  })
})
