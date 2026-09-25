/** Anbieter-Registry: baut Clients aus Konfiguration, cacht Modellisten kurz. */
import { randomUUID } from 'node:crypto'
import type { ModelInfo, ProviderConfig } from '@shared/types'
import type { SettingsService } from '../settings'
import type { Store } from '../db'
import { createOllamaClient } from './ollama'
import { createOpenAiClient } from './openai'
import type { ProviderClient } from './types'
import { log } from '../logger'

const MODEL_CACHE_MS = 15_000

export class ProviderRegistry {
  private cache = new Map<string, { at: number; models: ModelInfo[] }>()

  constructor(
    private store: Store,
    private settings: SettingsService
  ) {}

  list(): ProviderConfig[] {
    const providers = this.store.listProviders()
    if (providers.length > 0) return providers
    // Erster Start: lokaler Ollama-Standardanbieter vorbefüllt.
    const seed: ProviderConfig = {
      id: 'ollama-local',
      label: 'Ollama (lokal)',
      kind: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      hasKey: false,
      enabled: true
    }
    return [this.store.upsertProvider(seed, false)]
  }

  get(id: string): ProviderConfig | undefined {
    return this.list().find((p) => p.id === id)
  }

  save(provider: ProviderConfig, apiKey?: string): ProviderConfig {
    const id = provider.id || randomUUID()
    const next: ProviderConfig = { ...provider, id }
    if (apiKey !== undefined) {
      this.settings.setApiKey(id, apiKey)
    }
    const hasKey = this.settings.hasApiKey(id)
    const saved = this.store.upsertProvider(next, hasKey)
    this.cache.delete(id)
    return saved
  }

  remove(id: string): void {
    this.store.deleteProvider(id)
    this.settings.setApiKey(id, '')
    this.cache.delete(id)
  }

  client(idOrConfig: string | ProviderConfig): ProviderClient {
    const config = typeof idOrConfig === 'string' ? this.get(idOrConfig) : idOrConfig
    if (!config) throw new Error(`Anbieter unbekannt: ${idOrConfig}`)
    const apiKey = this.settings.getApiKey(config.id)
    if (config.kind === 'ollama') return createOllamaClient(config.id, config.baseUrl, apiKey)
    return createOpenAiClient(config.id, config.baseUrl, apiKey, { art: config.kind })
  }

  async models(refresh = false): Promise<ModelInfo[]> {
    const providers = this.list().filter((p) => p.enabled)
    const out: ModelInfo[] = []
    const errors: string[] = []
    await Promise.all(
      providers.map(async (provider) => {
        const cached = this.cache.get(provider.id)
        if (!refresh && cached && Date.now() - cached.at < MODEL_CACHE_MS) {
          out.push(...cached.models)
          return
        }
        try {
          const client = this.client(provider)
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 6000)
          const models = await client.listModels(controller.signal)
          clearTimeout(timer)
          this.cache.set(provider.id, { at: Date.now(), models })
          out.push(...models)
        } catch (e) {
          errors.push(`${provider.label}: ${(e as Error).message}`)
        }
      })
    )
    if (out.length === 0 && errors.length > 0) {
      log.warn('Keine Modelle gefunden', errors.join(' | '))
    }
    return out.sort((a, b) => a.label.localeCompare(b.label))
  }

  async test(id: string): Promise<{ ok: boolean; message: string; modelCount?: number; latencyMs?: number }> {
    const started = Date.now()
    try {
      const models = await this.modelsFor(id)
      return {
        ok: true,
        message: `${models.length} Modell(e) gefunden`,
        modelCount: models.length,
        latencyMs: Date.now() - started
      }
    } catch (e) {
      return { ok: false, message: (e as Error).message, latencyMs: Date.now() - started }
    }
  }

  private async modelsFor(id: string): Promise<ModelInfo[]> {
    const client = this.client(id)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const models = await client.listModels(controller.signal)
      this.cache.set(id, { at: Date.now(), models })
      return models
    } finally {
      clearTimeout(timer)
    }
  }

  /** Modell-Config zu einem Client auflösen (Provider-Präfix "providerId|modelId"). */
  resolve(reference: string | undefined): { client: ProviderClient; model: string; providerId: string } | undefined {
    const all = this.list()
    if (reference) {
      const [providerId, ...rest] = reference.split('|')
      const modelId = rest.join('|')
      const provider = all.find((p) => p.id === providerId)
      if (provider && modelId) return { client: this.client(provider), model: modelId, providerId: provider.id }
    }
    const first = all.find((p) => p.enabled)
    if (!first) return undefined
    return { client: this.client(first), model: '', providerId: first.id }
  }
}
