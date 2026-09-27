/**
 * Repariert doppelt kodierten Text in Tool-Argumenten: UTF-8-Bytes, die
 * unterwegs als Windows-1252 gelesen wurden („bÃ¶rige BÃ¤r“ statt „börige Bär“).
 * Kommt bei manchen lokalen Modellen (Ollama/MLX) in Werkzeug-Aufrufen vor,
 * während der normale Antworttext stimmt.
 */

// Windows-1252 belegt 0x80–0x9F mit eigenen Zeichen; ohne diese Tabelle
// bliebe z. B. „ÃŸ“ (ß) oder „â€ž“ („) unrepariert.
const CP1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f
}

// Typische Spuren: Leitbyte (Ã, Â, â, Å …) gefolgt von einem Folgebyte.
const VERDACHT = /[Â-ô][\u0080-¿ŒœŠšŸŽžƒˆ˜–-™]/

function alsBytes(text: string): Uint8Array | null {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    const ersatz = CP1252[text.charAt(i)]
    if (code <= 0xff) bytes[i] = code
    else if (ersatz !== undefined) bytes[i] = ersatz
    else return null
  }
  return bytes
}

export function repariereText(text: string): string {
  if (!VERDACHT.test(text)) return text
  const bytes = alsBytes(text)
  if (!bytes) return text
  try {
    // fatal: nur wenn die Bytes gültiges UTF-8 ergeben, war der Text doppelt kodiert.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return text
  }
}

/** Wendet die Reparatur auf alle Zeichenketten in den Argumenten an. */
export function repariereArgs<T>(wert: T): T {
  if (typeof wert === 'string') return repariereText(wert) as T
  if (Array.isArray(wert)) return wert.map((w) => repariereArgs(w)) as T
  if (wert && typeof wert === 'object') {
    return Object.fromEntries(Object.entries(wert).map(([k, v]) => [k, repariereArgs(v)])) as T
  }
  return wert
}
