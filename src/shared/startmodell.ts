import type { ChatMode, Settings } from './types'

/**
 * Das Modell für einen neuen Chat. „Zuletzt“: womit zuletzt gesendet wurde —
 * so ist nach dem Öffnen der App dasselbe Modell wieder eingestellt. „Fest“:
 * das in den Einstellungen gewählte. Fehlt eines, springt das andere ein.
 */
export function startModell(settings: Settings, mode: ChatMode = 'chat'): string | undefined {
  const fest = (mode === 'agent' ? settings.defaultModelAgent || settings.defaultModelChat : settings.defaultModelChat) || undefined
  if (settings.modellBeimStart === 'fest') return fest ?? (settings.zuletztModell || undefined)
  return settings.zuletztModell || fest
}
