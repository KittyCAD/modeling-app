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

  // The generic type T is used to assert the return type is T instead of `any`
  // or `unknown`. This is unsafe!
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  static decode<T>(data: Uint8Array): T {
    const delimited = Bytes.decode(data)
    const message = Headers.remove(delimited)
    return JSON.parse(message) as T
  }
}
