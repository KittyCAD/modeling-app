import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  createMessageDeframer,
  encodeMessage,
} from '@src/features/kclLsp/framing'
import { unicodeText } from '@src/test/properties'

/**
 * The LSP wire format, checked against arbitrary streams.
 *
 * `framing.ts` says it out loud: "framing bugs are the classic ones — a message
 * split across two chunks, two messages in one chunk, a multi-byte character
 * straddling a boundary — and they are only findable in a test." Those three
 * cases are exactly a property test's job, because the interesting variable is
 * *where the chunk boundaries fall*, and there are as many answers as there are
 * bytes in the stream.
 *
 * `framing.test.ts` covers the three by hand. This covers all of them.
 *
 * The framing is also the one place where a bug is invisible until it is
 * catastrophic: a deframer that loses one byte of alignment never recovers, and
 * what the user sees is a language server that stopped answering.
 */

const encoder = new TextEncoder()

const concat = (parts: readonly Uint8Array[]) => {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const joined = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    joined.set(part, at)
    at += part.byteLength
  }
  return joined
}

/**
 * Cut a stream into chunks of the given sizes, repeating them until it is spent.
 *
 * The sizes are what the property is really quantifying over. A transport hands
 * over whatever it got from the socket, so every split is a stream the app has
 * to survive — including one byte at a time.
 */
const chunk = (bytes: Uint8Array, sizes: readonly number[]) => {
  if (sizes.length === 0) return [bytes]

  const chunks: Uint8Array[] = []
  let at = 0
  let which = 0
  while (at < bytes.byteLength) {
    const size = sizes[which % sizes.length]
    chunks.push(bytes.subarray(at, at + size))
    at += size
    which += 1
  }
  return chunks
}

const collect = () => {
  const messages: string[] = []
  return {
    messages,
    deframe: createMessageDeframer((json) => messages.push(json)),
  }
}

/**
 * Message bodies, including the ones written to break the deframer.
 *
 * The header-shaped bodies are the point of the third case: a body is measured
 * in bytes, so text that looks like a frame boundary must be carried through as
 * text. A deframer that searched for `\r\n\r\n` inside the body instead of
 * trusting the length would pass every other property here.
 */
const messageBody = fc.oneof(
  { weight: 4, arbitrary: fc.json({ maxDepth: 3 }) },
  { weight: 2, arbitrary: unicodeText },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      '',
      '{}',
      '\r\n\r\n',
      'Content-Length: 5\r\n\r\nhello',
      '{"text":"line\r\nline"}',
      '{"id":"\u{1f431}\u{1f431}\u{1f431}"}',
      '{"name":"Grün","emoji":"\u{1f680}"}'
    ),
  }
)

const messages = fc.array(messageBody, { maxLength: 6 })
const chunkSizes = fc.array(fc.integer({ min: 1, max: 64 }), { maxLength: 6 })

describe('framing properties', () => {
  /**
   * The whole contract, in one property: what goes in comes out, in order,
   * exactly, no matter how the bytes arrive.
   */
  it('recovers every message from any chunking of the stream', () => {
    fc.assert(
      fc.property(messages, chunkSizes, (sent, sizes) => {
        const { messages: received, deframe } = collect()
        for (const part of chunk(concat(sent.map(encodeMessage)), sizes)) {
          deframe(part)
        }
        expect(received).toEqual(sent)
      })
    )
  })

  /**
   * The worst chunking there is, called out separately because it is the one a
   * generator reaches only by chance and the one that catches an off-by-one in
   * the header scan: with one byte per call, every intermediate state of the
   * buffer is visited.
   */
  it('recovers every message one byte at a time', () => {
    fc.assert(
      fc.property(messages, (sent) => {
        const { messages: received, deframe } = collect()
        const bytes = concat(sent.map(encodeMessage))
        for (let at = 0; at < bytes.byteLength; at += 1) {
          deframe(bytes.subarray(at, at + 1))
        }
        expect(received).toEqual(sent)
      })
    )
  })

  /**
   * A partial frame is silence, not a guess.
   *
   * Truncating the stream anywhere must yield a prefix of the messages — never a
   * short body decoded early, which would reach the LSP client as malformed JSON
   * and take the connection down.
   */
  it('emits nothing it has not fully received, and the rest when it arrives', () => {
    fc.assert(
      fc.property(messages, fc.nat(), (sent, cut) => {
        const bytes = concat(sent.map(encodeMessage))
        if (bytes.byteLength === 0) return

        const at = cut % bytes.byteLength
        const { messages: received, deframe } = collect()

        deframe(bytes.subarray(0, at))
        expect(sent.slice(0, received.length)).toEqual(received)

        deframe(bytes.subarray(at))
        expect(received).toEqual(sent)
      })
    )
  })

  /**
   * The header counts bytes. Stated against the encoder directly, because this
   * is the one number the peer trusts absolutely: a `Content-Length` measured in
   * UTF-16 code units would desynchronise the stream on the first identifier
   * that is not ASCII, and KCL identifiers are not all ASCII.
   */
  it('declares the byte length of the body, not its character length', () => {
    fc.assert(
      fc.property(messageBody, (json) => {
        const framed = encodeMessage(json)
        const header = new TextDecoder().decode(framed).split('\r\n\r\n')[0]
        const declared = Number(/content-length:\s*(\d+)/i.exec(header)?.[1])

        expect(declared).toBe(encoder.encode(json).byteLength)
        expect(framed.byteLength).toBe(
          encoder.encode(`${header}\r\n\r\n`).byteLength + declared
        )
      })
    )
  })

  /**
   * The peer is not our encoder.
   *
   * The server framing these messages is the KCL language server compiled to
   * WASM, and the protocol lets it write its headers how it likes: any casing,
   * any order, `Content-Type` alongside. Testing the deframer only against
   * `encodeMessage` would tie both halves to one spelling and leave the app one
   * server upgrade away from silence.
   */
  it('reads frames from a peer that writes its headers differently', () => {
    interface HeaderStyle {
      name: string
      spacing: string
      contentType: string
      typeFirst: boolean
    }

    const headerStyle = fc.record<HeaderStyle>({
      name: fc.constantFrom(
        'Content-Length',
        'content-length',
        'CONTENT-LENGTH'
      ),
      spacing: fc.constantFrom(' ', '  ', ''),
      contentType: fc.constantFrom(
        '',
        'Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n'
      ),
      typeFirst: fc.boolean(),
    })

    const framePeerStyle = (json: string, style: HeaderStyle) => {
      const body = encoder.encode(json)
      const length = `${style.name}:${style.spacing}${body.byteLength}\r\n`
      const header = style.typeFirst
        ? `${style.contentType}${length}`
        : `${length}${style.contentType}`
      return concat([encoder.encode(`${header}\r\n`), body])
    }

    fc.assert(
      fc.property(
        fc.array(fc.tuple(messageBody, headerStyle), { maxLength: 4 }),
        chunkSizes,
        (sent, sizes) => {
          const { messages: received, deframe } = collect()
          const bytes = concat(
            sent.map(([json, style]) => framePeerStyle(json, style))
          )
          for (const part of chunk(bytes, sizes)) deframe(part)

          expect(received).toEqual(sent.map(([json]) => json))
        }
      )
    )
  })
})
