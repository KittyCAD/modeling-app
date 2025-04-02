import type * as vsrpc from 'vscode-jsonrpc'

import StreamDemuxer from './demuxer'
import { decoder } from './encode-decode'
import Headers from './headers'
import Queue from './queue'
import Tracer from './tracer'

export enum LspWorkerEventType {
  Init = 'init',
  Call = 'call',
}

// FIXME: tracing efficiency
export class IntoServer
  extends Queue<Uint8Array>
  implements AsyncGenerator<Uint8Array, never, void>
{
  private worker: Worker | null = null
  private type_: string | null = null

  private trace: boolean = false

  constructor(type_?: string, worker?: Worker, trace?: boolean) {
    super()
    if (worker && type_) {
      this.worker = worker
      this.type_ = type_
    }

    this.trace = trace || false
  }
  enqueue(item: Uint8Array): void {
    if (this.trace) {
      Tracer.client(Headers.remove(decoder.decode(item)))
    }

    if (this.worker) {
      this.worker.postMessage({
        worker: this.type_,
        eventType: LspWorkerEventType.Call,
        eventData: item,
      })
    } else {
      super.enqueue(item)
    }
  }
}

export interface FromServer extends WritableStream<Uint8Array> {
  readonly responses: {
    get(key: number | string): null | Promise<vsrpc.ResponseMessage>
  }
  readonly notifications: AsyncGenerator<vsrpc.NotificationMessage, never, void>
  readonly requests: AsyncGenerator<vsrpc.RequestMessage, never, void>

  add(item: Uint8Array): void
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace FromServer {
  export function create(): FromServer | Error {
    // Calls private method .start() which can throw.
    // This is an odd one of the bunch but try/catch seems most suitable here.
    try {
      return new StreamDemuxer(false)
    } catch (e: any) {
      return e
    }
  }
}
