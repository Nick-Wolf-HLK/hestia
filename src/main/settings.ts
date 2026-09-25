/** Einstellungen (SQLite) + Geheimnisse (OS-Keyring über safeStorage). */
import { safeStorage } from 'electron'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { bekannteFelder } from './lib/raster'
import type { Store } from './db'
import { log } from './logger'

const KEY = 'settings'


export class SettingsService {
  private cache: Settings

  constructor(private store: Store) {
    const stored = store.getSetting<Partial<Settings>>(KEY)
    this.cache = { ...DEFAULT_SETTINGS, ...bekannteFelder(stored ?? {}) }
  }

  get(): Settings {
    return this.cache
  }

  set(patch: Partial<Settings>): Settings {
    this.cache = { ...this.cache, ...bekannteFelder(patch) }
    this.store.setSetting(KEY, this.cache)
    return this.cache
  }

  /** Keyring verfügbar? Ohne ihn fallen Geheimnisse auf unverschlüsselt zurück. */
  keychainAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private secretPath(providerId: string): string {
    return `secret:${providerId}`
  }

  setApiKey(providerId: string, apiKey: string): void {
    if (!apiKey) {
      this.store.setSetting(this.secretPath(providerId), null)
      return
    }
    if (this.keychainAvailable()) {
      try {
        const encrypted = safeStorage.encryptString(apiKey)
        this.store.setSetting(this.secretPath(providerId), { enc: encrypted.toString('base64') })
        return
      } catch (e) {
        log.error('Verschlüsselung fehlgeschlagen, speichere unverschlüsselt', (e as Error).message)
      }
    } else {
      log.warn('Kein Keyring verfügbar: API-Key wird unverschlüsselt abgelegt')
    }
    this.store.setSetting(this.secretPath(providerId), { plain: apiKey })
  }

  getApiKey(providerId: string): string | undefined {
    const entry = this.store.getSetting<{ enc?: string; plain?: string } | null>(this.secretPath(providerId))
    if (!entry) return undefined
    if (entry.enc) {
      try {
        return safeStorage.decryptString(Buffer.from(entry.enc, 'base64'))
      } catch (e) {
        log.error('Entschlüsselung fehlgeschlagen', (e as Error).message)
        return undefined
      }
    }
    return entry.plain
  }

  hasApiKey(providerId: string): boolean {
    return Boolean(this.store.getSetting(this.secretPath(providerId)))
  }
}
