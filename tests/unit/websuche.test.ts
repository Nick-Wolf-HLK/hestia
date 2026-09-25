/** webseite_lesen darf nur öffentliche Adressen lesen — nichts auf diesem Rechner oder im Heimnetz. */
import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), isPackaged: false }, BrowserWindow: class {} }))
const { oeffentlicheAdresse } = await import('../../src/main/agent/tools')
const { privateIp, oeffentlichesZiel } = await import('../../src/main/research/web')

describe('Öffentliche Adressen', () => {
  it('lässt normale Webseiten durch', () => {
    expect(oeffentlicheAdresse('https://de.wikipedia.org/wiki/Jesus_von_Nazareth')).toBeInstanceOf(URL)
    expect(oeffentlicheAdresse('http://example.org/a?b=1')).toBeInstanceOf(URL)
  })

  it('sperrt diesen Rechner, das Heimnetz, Tailscale und fremde Protokolle', () => {
    for (const url of [
      'http://localhost:11434/api/tags', 'http://127.0.0.1:8080/unload', 'http://[::1]/', 'http://192.168.1.1/',
      'http://10.0.0.5/', 'http://172.20.1.1/', 'http://100.67.42.0:8782/', 'http://drucker.local/', 'file:///etc/passwd', 'kein link'
    ]) {
      expect(typeof oeffentlicheAdresse(url), url).toBe('string')
    }
  })
  it('erkennt private Adressen auch in IPv6-Schreibweisen', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.31.0.1', '100.100.1.1', '169.254.1.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:c0a8:101']) {
      expect(privateIp(ip), ip).toBe(true)
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2a00:1450:4001:80b::200e', '172.32.0.1']) expect(privateIp(ip), ip).toBe(false)
    expect(typeof oeffentlicheAdresse('http://[::ffff:127.0.0.1]/'), 'verpackt').toBe('string')
  })

  it('löst Namen auf und sperrt, was auf private Adressen zeigt', async () => {
    await expect(oeffentlichesZiel('http://localhost:11434/')).rejects.toThrow(/Heimnetz/)
    await expect(oeffentlichesZiel('http://[::ffff:7f00:1]/')).rejects.toThrow(/Heimnetz/)
    await expect(oeffentlichesZiel('ftp://example.org/')).rejects.toThrow(/http/)
  })
})
