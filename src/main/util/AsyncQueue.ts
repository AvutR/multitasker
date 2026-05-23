/**
 * A push-driven async iterable. The orchestrator feeds an AgentSession's live
 * `query()` through one of these: the initial prompt is the first item, and
 * `steer()` pushes more user messages into the running session. Closing the
 * queue ends the session's input stream (the SDK run then completes).
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = []
  private resolvers: Array<(r: IteratorResult<T>) => void> = []
  private closed = false

  push(item: T): void {
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) resolve({ value: item, done: false })
    else this.items.push(item)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    let resolve: ((r: IteratorResult<T>) => void) | undefined
    while ((resolve = this.resolvers.shift())) {
      resolve({ value: undefined as never, done: true })
    }
  }

  get isClosed(): boolean {
    return this.closed
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const item = this.items.shift()
        if (item !== undefined) return Promise.resolve({ value: item, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => this.resolvers.push(resolve))
      }
    }
  }
}
