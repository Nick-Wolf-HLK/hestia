/** Markdown → sicheres HTML. marked für die Syntax, DOMPurify gegen XSS. */
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({
  gfm: true,
  breaks: false,
  async: false
})

/**
 * Wandelt Markdown in bereinigtes HTML um. Rohe HTML-Fragmente aus dem Modell
 * werden entfernt, Links erhalten target/rel.
 */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source ?? '') as string
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style']
  })
  return DOMPurify.sanitize(clean.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" '))
}

export function plainText(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```(\w*)/g, ''))
    .replace(/`/g, '')
    .replace(/[*_>#]/g, '')
}
