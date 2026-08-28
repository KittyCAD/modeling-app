import type { Transport } from '@codemirror/lsp-client'

/**
 * The client's transport, as a relay.
 *
 * `Transport` is three methods over strings, so it needs to know nothing about
 * workers — which is the point: the thing that owns the `Worker` handles
 * lifecycle and filesystem traffic too, and a transport that owned `onmessage`
 * would have to know about both.
 *
 * `receive` is called by whoever is reading the channel. Handlers are copied
 * before dispatch, because a handler that unsubscribes itself while being called
 * would otherwise be skipped over by the loop it is in.
 */
export function createRelayTransport(
  send: (json: string) => void
): Transport & {
  receive: (json: string) => void
  handlerCount: () => number
} {
  const handlers = new Set<(value: string) => void>()

  return {
    send,

    subscribe(handler) {
      handlers.add(handler)
    },

    unsubscribe(handler) {
      handlers.delete(handler)
    },

    receive(json) {
      for (const handler of [...handlers]) {
        try {
          handler(json)
        } catch (error) {
          // One bad handler must not stop the others, or lose the message for
          // everyone else listening.
          console.error('kclLsp: a message handler threw', error)
        }
      }
    },

    handlerCount: () => handlers.size,
  }
}
