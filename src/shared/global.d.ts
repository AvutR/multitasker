import type { IpcChannel, IpcEvent, IpcPayload, IpcResult } from './ipc'

declare global {
  interface Window {
    /** Bridge exposed by preload via contextBridge. The renderer's only door to the orchestrator. */
    api: {
      invoke<C extends IpcChannel>(
        channel: C,
        ...args: undefined extends IpcPayload<C> ? [payload?: IpcPayload<C>] : [payload: IpcPayload<C>]
      ): Promise<Awaited<IpcResult<C>>>
      /** Subscribe to streaming main->renderer events. Returns an unsubscribe fn. */
      on(listener: (event: IpcEvent) => void): () => void
    }
  }
}

export {}
