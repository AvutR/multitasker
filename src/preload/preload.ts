import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNEL } from '@shared/ipc'
import type { IpcEvent } from '@shared/ipc'

// The renderer's only door to the orchestrator. contextIsolation is ON and
// nodeIntegration OFF, so this narrow, typed surface is all the UI can reach.
contextBridge.exposeInMainWorld('api', {
  invoke: (channel: string, payload: unknown) => ipcRenderer.invoke(channel, payload),
  on: (listener: (event: IpcEvent) => void) => {
    const handler = (_e: unknown, evt: IpcEvent): void => listener(evt)
    ipcRenderer.on(EVENT_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(EVENT_CHANNEL, handler)
    }
  }
})
