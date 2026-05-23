import { EventEmitter } from 'node:events'
import type { IpcEvent } from '@shared/ipc'

/**
 * In-process pub/sub for streaming main->renderer events. main/index.ts
 * subscribes once and forwards to the focused window's webContents.
 * Decoupling here keeps services testable without Electron.
 */
export class EventBus {
  private ee = new EventEmitter()

  constructor() {
    // Many sessions stream concurrently; lift the default 10-listener cap.
    this.ee.setMaxListeners(200)
  }

  emit(event: IpcEvent): void {
    this.ee.emit('event', event)
  }

  onEvent(cb: (event: IpcEvent) => void): () => void {
    this.ee.on('event', cb)
    return () => this.ee.off('event', cb)
  }
}
