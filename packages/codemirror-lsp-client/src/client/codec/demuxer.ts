import * as vsrpc from 'vscode-jsonrpc'

import { Codec } from '.'
import Bytes from './bytes'
import Queue from './queue'
import Tracer from './tracer'
import PromiseMap from './map'

export default class StreamDemuxer extends Queue<Uint8Array> {
  readonly responses: PromiseMap<number | string, vsrpc.ResponseMessage> =
    new PromiseMap()
  readonly notifications: Queue<vsrpc.NotificationMessage> =
    new Queue<vsrpc.NotificationMessage>()
  readonly requests: Queue<vsrpc.RequestMessage> =
    new Queue<vsrpc.RequestMessage>()

  readonly #start: Promise<void>
  private trace: boolean = false

  constructor(trace?: boolean) {
    super()
    this.trace = trace || false

    this.#start = this.start()
  }

  private async start(): Promise<void> {
    let contentLength: null | number = null
    let buffer: Uint8Array = new Uint8Array()

    for await (const bytes of this) {
      buffer = Bytes.append(Uint8Array, buffer, bytes)
      while (buffer.length > 0) {
        // check if the content length is known
        if (null == contentLength) {
          // if not, try to match the prefixed headers
          const match = Bytes.decode(buffer).match(
            /^Content-Length:\s*(\d+)\s*/
          )
          if (null == match) continue

          // try to parse the content-length from the headers
          const length = parseInt(match[1])

          if (Number.isNaN(length))
            return Promise.reject(new Error('invalid content length'))

          // slice the headers since we now have the content length
          buffer = buffer.slice(match[0].length)

          // set the content length
          contentLength = length
        }

        // if the buffer doesn't contain a full message; await another iteration
        if (buffer.length < contentLength) continue

        // Get just the slice of the buffer that is our content length.
        const slice = buffer.slice(0, contentLength)

        // decode buffer to a string
        const delimited = Bytes.decode(slice)

        // reset the buffer
        buffer = buffer.slice(contentLength)
        // reset the contentLength
        contentLength = null

        const message = JSON.parse(delimited) as vsrpc.Message

        if (this.trace) {
          Tracer.server(message)
        }

        // demux the message stream
        if (vsrpc.Message.isResponse(message) && null != message.id) {
          this.responses.set(message.id, message)
          continue
        }
        if (vsrpc.Message.isNotification(message)) {
          this.notifications.enqueue(message)
          continue
        }
        if (vsrpc.Message.isRequest(message)) {
          this.requests.enqueue(message)
          continue
        }
      }
    }
  }

  add(bytes: Uint8Array): void {
    const message = Codec.decode<vsrpc.Message>(bytes)
    if (this.trace) {
      Tracer.server(message)
    }

    // demux the message stream
    if (vsrpc.Message.isResponse(message) && null != message.id) {
      this.responses.set(message.id, message)
    }
    if (vsrpc.Message.isNotification(message)) {
      this.notifications.enqueue(message)
    }
    if (vsrpc.Message.isRequest(message)) {
      this.requests.enqueue(message)
    }
  }
}
