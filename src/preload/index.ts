/** Vorladendes Skript: schmale, typisierte Brücke über contextBridge. */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { bauDesk, type Leitung } from '@shared/desk-api'

/** Electrons Kanäle als Leitung — der Bauplan selbst liegt in shared/desk-api. */
const leitung: Leitung = {
  invoke: <T>(kanal: string, eingabe?: unknown) => ipcRenderer.invoke(kanal, eingabe) as Promise<T>,
  send: (kanal, eingabe) => ipcRenderer.send(kanal, eingabe),
  on: (kanal, hoerer) => {
    const zuhoerer = (_event: IpcRendererEvent, ...werte: unknown[]): void => hoerer(...werte)
    ipcRenderer.on(kanal, zuhoerer)
    return () => ipcRenderer.removeListener(kanal, zuhoerer)
  }
}

contextBridge.exposeInMainWorld('desk', bauDesk(leitung, process.platform, false))
