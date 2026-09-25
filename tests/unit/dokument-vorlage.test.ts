/**
 * Die Druckvorlage: Deckel, Kapitel, Bilder.
 *
 * Geprüft wird das HTML, das in den Chromium-Drucker geht — denn dort
 * entscheidet sich, ob ein Papier entsteht oder ein Ausdruck.
 */
import { describe, expect, it } from 'vitest'
import { parseMarkdown, renderHtmlDocument } from '../../src/main/documents/markdown'

const MUSTER = `# Der kleine Bär

Eine Widmung.

![Der Bär am Himmel](titel.png)

## Kapitel 1

Es war einmal.

![Zwei Bilder](wald.png)

![Und der Fluss](fluss.png)

> Ein Zitat über Mut.
`

function dokument(): string {
  return renderHtmlDocument('Der kleine Bär', parseMarkdown(MUSTER), {
    untertitel: 'Eine Geschichte über Mut',
    zeile: 'Hestia',
    einbetten: (quelle) => (quelle === 'fehit.png' ? null : `data:image/png;base64,${quelle}`),
    // Das gesetzte Heft gibt es nur noch auf Wunsch.
    gestaltung: { vorlage: 'klassisch' }
  })
}

describe('die gesetzte Vorlage', () => {
  it('baut einen Deckel mit Titel, Signatur und Datum', () => {
    const html = dokument()
    expect(html).toContain('class="deckel"')
    expect(html).toContain('<h1>Der kleine Bär</h1>')
    expect(html).toContain('Eine Geschichte über Mut')
    expect(html).toContain('deckel__fuss')
  })

  it('wiederholt den Deckeltitel nicht im Satz', () => {
    // Die erste # steht auf dem Deckel — sie darf nicht noch einmal erscheinen.
    const html = dokument()
    expect(html.match(/<h1>Der kleine Bär<\/h1>/g)).toHaveLength(1)
    expect(html).not.toContain('<section class="kapitel"><h1>Der kleine Bär</h1>')
  })

  it('setzt jedes Kapitel in eine eigene Sektion', () => {
    const html = dokument()
    expect(html).toContain('<section class="kapitel"><h2>Kapitel 1</h2>')
    expect(html).toContain('Es war einmal.')
  })

  it('zählt Kapitel auch ohne Deckelüberschrift', () => {
    const html = renderHtmlDocument('Buch', parseMarkdown('# Erstes\n\nText.\n\n# Zweites\n\nMehr.'))
    expect(html).toContain('<section class="kapitel"><h1>Erstes</h1>')
    expect(html).toContain('<section class="kapitel"><h1>Zweites</h1>')
  })

  it('setzt die Signatur nicht ein zweites Mal in den Satz', () => {
    const html = dokument()
    expect(html.match(/Eine Geschichte über Mut/g)).toHaveLength(1)
    // Und das erste Bild wandert auf den Deckel, nicht in den Fluß.
    expect(html.indexOf('data:image/png;base64,titel.png')).toBeLessThan(html.indexOf('class="kapitel"'))
  })

  it('bettet Bilder mit dem Bildpunkt ein, nicht mit dem Pfad', () => {
    const html = dokument()
    expect(html).toContain('src="data:image/png;base64,titel.png"')
    expect(html).toContain('<figcaption>Zwei Bilder</figcaption>')
  })

  it('macht zwei Bilder hintereinander zu einer Bildzeile', () => {
    const html = dokument()
    const zeile = html.match(/<div class="galerie">.*?<\/div>/s)?.[0] ?? ''
    expect(zeile.split('<figure>').length - 1).toBe(2)
  })

  it('lässt ein fehlendes Bild als Bild stehen', () => {
    const html = renderHtmlDocument('Test', parseMarkdown('![Weg](fehit.png)'), {
      einbetten: () => null
    })
    expect(html).toContain('<img src="fehit.png"')
  })

  it('trägt Serifensatz, Silbentrennung und Seitenumbruch der Kapitel', () => {
    const css = renderHtmlDocument('Test', parseMarkdown('# A\n\n## B\n\nText.'), { gestaltung: { vorlage: 'klassisch' } })
    expect(css).toContain('DejaVu Serif')
    expect(css).toContain('hyphens: auto')
    expect(css).toContain('.kapitel + .kapitel { break-before: page; }')
    expect(css).toContain('@page { size: A4')
  })

  it('liest eine Bildzeile als Bildblock', () => {
    const blocks = parseMarkdown('![Ein Bild](a.png)')
    expect(blocks).toEqual([{ type: 'image', src: 'a.png', label: 'Ein Bild' }])
  })
})
