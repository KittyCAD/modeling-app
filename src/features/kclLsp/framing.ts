/**
 * The LSP wire format, in both directions.
 *
 * The protocol frames each message with a `Content-Length` header, which is what
 * the KCL server compiled into WASM reads and writes. `@codemirror/lsp-client`
 * deliberately does not: its transport carries "only the JSON messages, no LSP
 * headers". So this is the adapter between them, and it lives in the worker
 * where the server is.
 *
 * Both directions are pure functions over bytes and strings, which is why they
 * are here and not inline in the worker: framing bugs are the classic ones —
 * a message split across two chunks, two messages in one chunk, a multi-byte
 * character straddling a boundary — and they are only findable in a test.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const HEADER_END = '\r\n\r\n'
const CONTENT_LENGTH = /content-length:\s*(\d+)/i

/** Frame one JSON message for the server. */
export function encodeMessage(json: string): Uint8Array {
  const body = encoder.encode(json)
  // Byte length, not string length: the header counts bytes, and a KCL file's
  // identifiers are not all ASCII.
  const header = encoder.encode(
    `Content-Length: ${body.byteLength}${HEADER_END}`
  )

  const framed = new Uint8Array(header.byteLength + body.byteLength)
  framed.set(header, 0)
  framed.set(body, header.byteLength)
  return framed
}

/**
 * Reassemble JSON messages from whatever chunks arrive.
 *
 * Stateful because a chunk boundary means nothing to the protocol: one write may
 * carry half a message, or three of them, and the split can fall inside a
 * multi-byte character. So the search runs over *bytes* and only a complete body
 * is ever decoded — decoding the buffer to find the header would mix character
 * offsets with byte offsets, and a streaming decoder reused across chunks keeps
 * partial-character state that a second pass over the same bytes corrupts.
 */
export function createMessageDeframer(
  onMessage: (json: string) => void
): (chunk: Uint8Array) => void {
  let buffer = new Uint8Array(0)

  const append = (chunk: Uint8Array) => {
    const next = new Uint8Array(buffer.byteLength + chunk.byteLength)
    next.set(buffer, 0)
    next.set(chunk, buffer.byteLength)
    buffer = next
  }

  /** Where the `\r\n\r\n` after the headers ends, in bytes. */
  const bodyStart = () => {
    for (let at = 0; at + 3 < buffer.byteLength; at += 1) {
      if (
        buffer[at] === 13 &&
        buffer[at + 1] === 10 &&
        buffer[at + 2] === 13 &&
        buffer[at + 3] === 10
      ) {
        return at + 4
      }
    }
    return -1
  }

  return (chunk: Uint8Array) => {
    append(chunk)

    for (;;) {
      const start = bodyStart()
      if (start === -1) return

      // Headers are ASCII by specification, so this slice decodes exactly.
      const headers = decoder.decode(buffer.subarray(0, start))
      const match = CONTENT_LENGTH.exec(headers)
      if (!match) {
        // A frame we cannot measure is a frame we cannot skip past, so the
        // stream is unrecoverable from here. Dropping the buffer at least stops
        // it growing without bound.
        console.error('kclLsp: a message arrived with no content length')
        buffer = new Uint8Array(0)
        return
      }

      const length = Number(match[1])
      if (buffer.byteLength < start + length) return

      onMessage(decoder.decode(buffer.subarray(start, start + length)))
      buffer = buffer.slice(start + length)
    }
  }
}
