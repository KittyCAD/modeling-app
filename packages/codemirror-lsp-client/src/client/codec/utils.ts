import type * as jsrpc from 'json-rpc-2.0'

import Bytes from './bytes'
import Headers from './headers'

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
