import { app } from 'electron'
import { join } from 'node:path'
import { appendFileSync, mkdirSync } from 'node:fs'

let logFile: string | undefined

function file(): string | undefined {
  if (logFile) return logFile
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    logFile = join(dir, 'main.log')
    return logFile
  } catch {
    return undefined
  }
}

function line(level: string, msg: string, extra?: unknown): string {
  const stamp = new Date().toISOString()
  let tail = ''
  if (extra !== undefined) {
    try {
      tail = ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))
    } catch {
      tail = ' [nicht serialisierbar]'
    }
  }
  return `[${stamp}] ${level.toUpperCase().padEnd(5)} ${msg}${tail}\n`
}

function write(level: string, msg: string, extra?: unknown): void {
  const l = line(level, msg, extra)
  process.stdout.write(l)
  const f = file()
  if (f) {
    try {
      appendFileSync(f, l, 'utf8')
    } catch {
      /* Logging darf nie die App reißen */
    }
  }
}

export const log = {
  info: (msg: string, extra?: unknown) => write('info', msg, extra),
  warn: (msg: string, extra?: unknown) => write('warn', msg, extra),
  error: (msg: string, extra?: unknown) => write('error', msg, extra)
}
