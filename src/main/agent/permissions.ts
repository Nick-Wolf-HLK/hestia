/**
 * Berechtigungs-Broker: der Agent fragt an, der Mensch entscheidet.
 * Anfragen laufen als IPC an den Renderer und werden dort als Prüfkarten shown.
 */
import { ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { Channels } from '@shared/ipc'
import type { PermissionDecision, PermissionRequest } from '@shared/types'
import { log } from '../logger'
import { fernEinseitig } from '../fern'

/** Interner Schlüssel, damit "merken" nicht über die IPC wandert. */
interface PendingEntry {
  request: PermissionRequest
  rememberKey?: string
  resolve: (allowed: boolean) => void
  timer: NodeJS.Timeout
}

const TIMEOUT_MS = 5 * 60_000

export class PermissionBroker {
  private pending = new Map<string, PendingEntry>()
  private remembered = new Set<string>()

  constructor(private getTargets: () => WebContents[]) {
    ipcMain.on(Channels.permissionRespond, (_event, decision: PermissionDecision) => this.settle(decision))
    // Freigaben lassen sich auch aus dem Browser beantworten (Handy, MacBook).
    fernEinseitig(Channels.permissionRespond, (decision) => this.settle(decision as PermissionDecision))
  }

  /** Fragt den Menschen; ohne Antwort innerhalb des Zeitlimits wird abgelehnt. */
  async ask(request: Omit<PermissionRequest, 'id'> & { rememberKey?: string }): Promise<boolean> {
    if (request.rememberKey && this.remembered.has(request.rememberKey)) return true

    const id = randomUUID()
    const rememberKey = request.rememberKey
    const full: PermissionRequest = { id, chatId: request.chatId, kind: request.kind, target: request.target, detail: request.detail }

    return new Promise<boolean>((resolvePromise) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        log.warn('Berechtigungsanfrage abgelaufen', request.target)
        this.closed(id)
        resolvePromise(false)
      }, TIMEOUT_MS)

      this.pending.set(id, { request: full, rememberKey, resolve: resolvePromise, timer })
      for (const contents of this.getTargets()) {
        if (!contents.isDestroyed()) contents.send(Channels.permissionRequest, full)
      }
    })
  }

  private settle(decision: PermissionDecision): void {
    const entry = this.pending.get(decision.id)
    if (!entry) return
    this.pending.delete(decision.id)
    clearTimeout(entry.timer)
    if (decision.allowed && decision.remember && entry.rememberKey) {
      this.remembered.add(entry.rememberKey)
    }
    entry.resolve(Boolean(decision.allowed))
  }

  /** Offene Anfragen ablehnen (z. B. beim Beenden eines Laufs). */
  cancelFor(chatId: string): void {
    for (const [id, entry] of this.pending) {
      if (entry.request.chatId === chatId) {
        clearTimeout(entry.timer)
        entry.resolve(false)
        this.pending.delete(id)
        this.closed(id)
      }
    }
  }

  /**
   * Der Oberfläche sagen, dass eine Karte nichts mehr bewirkt. Sonst bleibt sie
   * stehen, und ein späterer Klick auf „Erlauben" geht ins Leere — während die
   * neue, echte Anfrage darunter wartet.
   */
  private closed(id: string): void {
    for (const contents of this.getTargets()) {
      if (!contents.isDestroyed()) contents.send(Channels.permissionClosed, id)
    }
  }

  forgetAll(): void {
    this.remembered.clear()
  }
}
