import { describe, expect, it, vi } from 'vitest'
import {
  createMessageDeframer,
  encodeMessage,
} from '@src/features/kclLsp/framing'

const decoder = new TextDecoder()
const encoder = new TextEncoder()

describe('encodeMessage', () => {
  it('frames a message with its length', () => {
    const framed = decoder.decode(encodeMessage('{"a":1}'))
    expect(framed).toBe('Content-Length: 7\r\n\r\n{"a":1}')
  })

  /** The header counts bytes, and KCL identifiers are not all ASCII. */
  it('counts bytes, not characters', () => {
    const framed = decoder.decode(encodeMessage('{"n":"é"}'))
    expect(framed.startsWith('Content-Length: 10\r\n\r\n')).toBe(true)
  })
})

describe('createMessageDeframer', () => {
  const collect = () => {
    const messages: string[] = []
    return { messages, deframe: createMessageDeframer((m) => messages.push(m)) }
  }

  it('reads one whole message', () => {
    const { messages, deframe } = collect()
    deframe(encodeMessage('{"a":1}'))
    expect(messages).toEqual(['{"a":1}'])
  })

  it('reads several messages out of one chunk', () => {
    const { messages, deframe } = collect()
    const first = encodeMessage('{"a":1}')
    const second = encodeMessage('{"b":2}')
    const both = new Uint8Array(first.byteLength + second.byteLength)
    both.set(first, 0)
    both.set(second, first.byteLength)

    deframe(both)
    expect(messages).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('waits for a message split across chunks', () => {
    const { messages, deframe } = collect()
    const framed = encodeMessage('{"a":1}')

    deframe(framed.subarray(0, 10))
    expect(messages).toEqual([])
    deframe(framed.subarray(10))
    expect(messages).toEqual(['{"a":1}'])
  })

  it('waits when the split falls inside the headers', () => {
    const { messages, deframe } = collect()
    const framed = encodeMessage('{"a":1}')

    deframe(framed.subarray(0, 4))
    deframe(framed.subarray(4, 12))
    expect(messages).toEqual([])
    deframe(framed.subarray(12))
    expect(messages).toEqual(['{"a":1}'])
  })

  /**
   * The bug a byte-wise buffer exists to prevent: a chunk boundary inside a
   * multi-byte character. Decoding either half alone produces a replacement
   * character that never recovers.
   */
  it('survives a split inside a multi-byte character', () => {
    const { messages, deframe } = collect()
    const framed = encodeMessage('{"n":"é"}')
    const cut = framed.byteLength - 3

    deframe(framed.subarray(0, cut))
    deframe(framed.subarray(cut))

    expect(messages).toEqual(['{"n":"é"}'])
  })

  it('accepts a header in any case, with extra headers alongside', () => {
    const { messages, deframe } = collect()
    const body = '{"a":1}'
    deframe(
      encoder.encode(
        `content-type: application/vscode-jsonrpc\r\ncontent-length: ${body.length}\r\n\r\n${body}`
      )
    )
    expect(messages).toEqual([body])
  })

  it('gives up on a frame it cannot measure, rather than growing forever', () => {
    const { messages, deframe } = collect()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    deframe(encoder.encode('X-Nonsense: 1\r\n\r\n{"a":1}'))
    expect(messages).toEqual([])
    expect(error).toHaveBeenCalled()

    // And the next well-formed message still reads, because the buffer was reset.
    deframe(encodeMessage('{"b":2}'))
    expect(messages).toEqual(['{"b":2}'])
    error.mockRestore()
  })
})
