import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    environment: 'node',
    /**
     * nacheinander, jede Datei für sich.
     *
     * Mehrere Prüfungen starten echte Zugänge auf Ports im System. Neben­einander
     * liefen sie sich gelegentlich ins Wort — ein Ausfall, der je nach Laune
     * wechselte und damit nichts über die App aussagte. Eine Prüfung, die nur
     * manchmal fehlt, ist keine.
     */
    pool: 'forks',
    poolOptions: { forks: { minForks: 1, maxForks: 1 } },
    isolate: true,
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000
  }
})
