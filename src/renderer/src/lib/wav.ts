/**
 * Aus aufgenommenen Tonproben eine WAV-Datei machen.
 *
 * Der Browser nimmt als WebM/Opus auf — das versteht kein Erkennungsprogramm
 * draußen. Deshalb hier selbst rechnen: Pulsfrequenz abtasten, in 16-Bit-Ganzzahlen
 * legen, den kurzen Kopf davor. Das ist absichtlich kein Vollformat, sondern das,
 * was whisper & Co. sicher lesen.
 */
export function wavAusSample(kanaele: Float32Array[], pulsfrequenz: number): Blob {
  const kanal = kanaele[0] ?? new Float32Array(0)
  const daten = new DataView(new ArrayBuffer(44 + kanal.length * 2))
  const schreiben = (stelle: number, text: string): void => {
    for (let n = 0; n < text.length; n++) daten.setUint8(stelle + n, text.charCodeAt(n))
  }
  schreiben(0, 'RIFF')
  daten.setUint32(4, 36 + kanal.length * 2, true)
  schreiben(8, 'WAVE')
  schreiben(12, 'fmt ')
  daten.setUint32(16, 16, true)
  daten.setUint16(20, 1, true)
  daten.setUint16(22, 1, true)
  daten.setUint32(24, pulsfrequenz, true)
  daten.setUint32(28, pulsfrequenz * 2, true)
  daten.setUint16(32, 2, true)
  daten.setUint16(34, 16, true)
  schreiben(36, 'data')
  daten.setUint32(40, kanal.length * 2, true)
  let stelle = 44
  for (const wert of kanal) {
    const geklemmt = Math.max(-1, Math.min(1, wert))
    daten.setInt16(stelle, geklemmt < 0 ? geklemmt * 0x8000 : geklemmt * 0x7fff, true)
    stelle += 2
  }
  return new Blob([daten.buffer], { type: 'audio/wav' })
}

/** Ein Blob in den Text umrechnen, den die Leitung erwartet. */
export function grundlos(blob: Blob): Promise<string> {
  return new Promise((resolve, abweisen) => {
    const leser = new FileReader()
    leser.onload = () => resolve(String(leser.result ?? '').split(',')[1] ?? '')
    leser.onerror = () => abweisen(new Error('Die Aufnahme ließ sich nicht lesen.'))
    leser.readAsDataURL(blob)
  })
}
