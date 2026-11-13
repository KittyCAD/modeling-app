import * as msgpack from '@msgpack/msgpack'
import { vi } from 'vitest'

export function encodeReplayMessage(message: unknown): number[] {
  return Array.from(new TextEncoder().encode(JSON.stringify(message)))
}

export class ControllableSetupWebSocket extends EventTarget {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: ControllableSetupWebSocket[] = []

  readonly url: string
  readonly sentPayloads: string[] = []
  binaryType: BinaryType = 'blob'
  bufferedAmount = 0
  readyState = ControllableSetupWebSocket.CONNECTING

  constructor(url: string) {
    super()
    this.url = url
    ControllableSetupWebSocket.instances.push(this)
  }

  send(payload: string) {
    this.sentPayloads.push(payload)
  }

  open() {
    this.readyState = ControllableSetupWebSocket.OPEN
    this.dispatchEvent(new Event('open'))
  }

  receive(payload: unknown, format: 'json' | 'msgpack' = 'json') {
    this.dispatchEvent(
      new MessageEvent('message', {
        data:
          format === 'msgpack'
            ? Uint8Array.from(msgpack.encode(payload)).buffer
            : JSON.stringify(payload),
      })
    )
  }

  close = vi.fn(() => {
    this.closeWithCode(1000)
  })

  closeWithCode(code: number, reason = '') {
    if (this.readyState === ControllableSetupWebSocket.CLOSED) {
      return
    }
    this.readyState = ControllableSetupWebSocket.CLOSED
    const closeEvent = new Event('close')
    Object.defineProperties(closeEvent, {
      code: { value: code },
      reason: { value: reason },
      wasClean: { value: code === 1000 },
    })
    this.dispatchEvent(closeEvent)
  }
}
