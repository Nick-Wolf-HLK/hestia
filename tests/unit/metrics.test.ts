import { describe, expect, it } from 'vitest'
import { computeMetrics, estimateTokens } from '../../src/main/metrics'

describe('Durchsatz einer Antwort', () => {
  it('rechnet die gemeldete Tokenzahl auf die Sekunde um', () => {
    const metrics = computeMetrics({ usage: { output: 200, input: 500 }, chars: 800, durationMs: 4000 })

    expect(metrics.perSecond).toBe(50)
    expect(metrics.outputTokens).toBe(200)
    expect(metrics.inputTokens).toBe(500)
    expect(metrics.estimated).toBe(false)
  })

  it('schätzt über die Zeichenlänge, wenn der Anbieter nichts meldet', () => {
    const metrics = computeMetrics({ chars: 400, durationMs: 2000 })

    expect(metrics.estimated).toBe(true)
    expect(metrics.outputTokens).toBe(100)
    expect(metrics.perSecond).toBe(50)
  })

  it('nimmt die Meldung des Anbieters statt der Schätzung', () => {
    const metrics = computeMetrics({ usage: { output: 42 }, chars: 100_000, durationMs: 1000 })

    expect(metrics.outputTokens).toBe(42)
    expect(metrics.perSecond).toBe(42)
    expect(metrics.estimated).toBe(false)
  })

  it('bleibt bei leerer Antwort und bei kurzer Zeit vernünftig', () => {
    expect(computeMetrics({ chars: 0, durationMs: 0 }).perSecond).toBe(0)
    expect(computeMetrics({ usage: { output: 3 }, chars: 12, durationMs: 1 }).perSecond).toBe(3000)
    expect(computeMetrics({ chars: 0, durationMs: 0 }).durationMs).toBe(0)
  })

  it('lässt die Zeit nie ganz Null werden, damit die Division trägt', () => {
    const metrics = computeMetrics({ usage: { output: 1 }, chars: 4, durationMs: 0 })

    expect(metrics.perSecond).toBeGreaterThan(0)
  })

  it('rundet die Rate auf eine Nachkommastelle', () => {
    // 7 Token in 3 Sekunden sind 2,33… — angezeigt werden soll 2,3
    expect(computeMetrics({ usage: { output: 7 }, chars: 28, durationMs: 3000 }).perSecond).toBe(2.3)
  })

  it('schätzt nie negative Werte', () => {
    expect(estimateTokens(0)).toBe(0)
    expect(computeMetrics({ chars: 0, durationMs: -50 }).durationMs).toBe(0)
  })
})
