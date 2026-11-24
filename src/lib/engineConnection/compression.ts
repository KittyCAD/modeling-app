type DecompressionResult = { data: ArrayBuffer } | { error: string }

export class ModelingResponseDecoder {
  private worker: Worker | undefined
  private queue: MessageEvent[] = []
  private busy = false
  private disposed = false

  constructor(
    private deliver: (event: MessageEvent) => void,
    private onError: (error: Error) => void
  ) {}

  handleMessage = (event: MessageEvent) => {
    if (this.disposed) return
    this.queue.push(event)
    this.drain()
  }

  dispose() {
    this.disposed = true
    this.queue.length = 0
    this.worker?.terminate()
    this.worker = undefined
  }

  private drain() {
    while (!this.busy && this.queue.length) {
      const event = this.queue.shift()!
      const data: unknown = event.data
      if (
        !(data instanceof ArrayBuffer) ||
        data.byteLength < 4 ||
        new DataView(data).getUint32(0, true) !== 0xfd2fb528
      ) {
        this.deliver(event)
        continue
      }
      this.busy = true
      try {
        this.worker ??= new Worker(
          new URL('./decompress.worker.ts', import.meta.url),
          {
            type: 'module',
          }
        )
        this.worker.onmessage = (result: MessageEvent<DecompressionResult>) => {
          if (this.disposed) return
          if ('error' in result.data) {
            this.fail(new Error(result.data.error))
            return
          }
          this.busy = false
          this.deliver(new MessageEvent('message', { data: result.data.data }))
          this.drain()
        }
        this.worker.onerror = (error) => this.fail(new Error(error.message))
        this.worker.postMessage(data)
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  private fail(error: Error) {
    if (this.disposed) return
    this.dispose()
    this.onError(error)
  }
}
