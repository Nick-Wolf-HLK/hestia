/**
 * Die Suche der Tieferen Recherche.
 *
 * Kein Netz in diesen Prüfungen: vorgezeigt wird eine Antwortseite wie sie
 * wirklich aussieht, inklusive Umlenker, Werbung und Zeichenkrücken.
 */
import { describe, expect, it } from 'vitest'
import { echteAdresse, entschlüsseln, textAusHtml, trefferLesen } from '../../src/main/research/web'

const SEITE = `<html><body>
<div class="result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbeispiel.de%2Fpreis&amp;rut=ab">Der &amp; Preis — ein Test</a>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbeispiel.de%2Fpreis">Hier steht <b>weniges</b> zur Sache.</a>
</div>
<div class="result">
  <a class="result__a" href="https://andere.example/weg">Zweiter Treffer</a>
  <td class="result__snippet">Kurzer Text mit &#8211; Gedankenstrich.</td>
</div>
<div class="result">
  <a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=werbung.example">Anzeige</a>
  <a class="result__snippet">Soll nicht zählen.</a>
</div>
</body></html>`

describe('die Suche', () => {
  it('liest Titel, Adresse und Text aus einer echten Antwortseite', () => {
    const funde = trefferLesen(SEITE)
    expect(funde).toHaveLength(2)
    expect(funde[0]!.titel).toBe('Der & Preis — ein Test')
    expect(funde[0]!.url).toBe('https://beispiel.de/preis')
    expect(funde[0]!.text).toContain('weniges zur Sache')
    expect(funde[1]!.text).toContain('Gedankenstrich')
  })

  it('wirft die Werbung raus, weil ihre Adresse eine Zwischenstation ist', () => {
    expect(trefferLesen(SEITE).some((fund) => fund.url.includes('y.js'))).toBe(false)
  })

  it('löst den Umlenker auf und lässt echte Adressen in Ruhe', () => {
    expect(echteAdresse('//duckduckgo.com/l/?uddg=https%3A%2F%2Fx.example%2Fa')).toBe('https://x.example/a')
    expect(echteAdresse('https://x.example/b')).toBe('https://x.example/b')
    expect(echteAdresse('https://duckduckgo.com/l/?rut=nur')).toBe('')
  })

  it('macht aus einer Seite lesbaren Text ohne Beiwerk', () => {
    const text = textAusHtml(
      '<html><head><style>b { color: red }</style></head><body><h1>Zwischenstand</h1><p>Erstens dies.</p><p>Zweitens&nbsp;das.</p><script>geheim()</script></body></html>'
    )
    expect(text).toContain('Zwischenstand')
    expect(text).toContain('Erstens dies.')
    expect(text).toContain('Zweitens das.')
    expect(text).not.toContain('geheim')
    expect(text).not.toContain('color')
  })

  it('entschlüsselt die Krücken der Antwortseite', () => {
    expect(entschlüsseln('A &amp; B &lt;C&gt; &#8211; „x&#8220;')).toBe('A & B <C> – „x“')
  })

  it('gibt eine Höchstabfrage an die Zahl der Treffer weiter', () => {
    expect(trefferLesen(SEITE, 1)).toHaveLength(1)
  })
})
