import * as jsrpc from 'json-rpc-2.0'
import * as vsrpc from 'vscode-jsonrpc'

import Bytes from './codec/bytes'
import StreamDemuxer from './codec/demuxer'
import Headers from './codec/headers'
import Queue from './codec/queue'
import Tracer from './tracer'

export const encoder = new TextEncoder()
export const decoder = new TextDecoder()

export class Codec {
  static encode(
    json: jsrpc.JSONRPCRequest | jsrpc.JSONRPCResponse
  ): Uint8Array {
    const message = JSON.stringify(json)
    const delimited = Headers.add(message)
    return Bytes.encode(delimited)
  }

  static decode<T>(data: Uint8Array): T {
    const delimited = Bytes.decode(data)
    const message = Headers.remove(delimited)
    return JSON.parse(message) as T
  }
}

// FIXME: tracing efficiency
export class IntoServer
  extends Queue<Uint8Array>
  implements AsyncGenerator<Uint8Array, never, void>
{
  enqueue(item: Uint8Array): void {
    Tracer.client(Headers.remove(decoder.decode(item)))
    super.enqueue(item)
  }
}

export interface FromServer extends WritableStream<Uint8Array> {
  readonly responses: {
    get(key: number | string): null | Promise<vsrpc.ResponseMessage>
  }
  readonly notifications: AsyncGenerator<vsrpc.NotificationMessage, never, void>
  readonly requests: AsyncGenerator<vsrpc.RequestMessage, never, void>
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace FromServer {
  export function create(): FromServer {
    return new StreamDemuxer()
  }
}
