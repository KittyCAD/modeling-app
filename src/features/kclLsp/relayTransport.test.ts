import { describe, expect, it, vi } from 'vitest'
import { createRelayTransport } from '@src/features/kclLsp/relayTransport'

describe('relay transport', () => {
  it('sends through whatever it was given', () => {
    const sent: string[] = []
    const transport = createRelayTransport((json) => sent.push(json))

    transport.send('{"id":1}')
    expect(sent).toEqual(['{"id":1}'])
  })

  it('delivers to every subscriber, and stops when they go', () => {
    const transport = createRelayTransport(() => {})
    const first: string[] = []
    const second: string[] = []
    const one = (json: string) => first.push(json)
    const two = (json: string) => second.push(json)

    transport.subscribe(one)
    transport.subscribe(two)
    transport.receive('{"a":1}')

    transport.unsubscribe(one)
    transport.receive('{"b":2}')

    expect(first).toEqual(['{"a":1}'])
    expect(second).toEqual(['{"a":1}', '{"b":2}'])
    expect(transport.handlerCount()).toBe(1)
  })

  /** A handler that unsubscribes itself must not make the loop skip the next. */
  it('survives a handler unsubscribing itself mid-dispatch', () => {
    const transport = createRelayTransport(() => {})
    const seen: string[] = []

    const first = () => {
      transport.unsubscribe(first)
    }
    transport.subscribe(first)
    transport.subscribe((json) => seen.push(json))

    transport.receive('{"a":1}')
    expect(seen).toEqual(['{"a":1}'])
  })

  it('keeps going when a handler throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const transport = createRelayTransport(() => {})
    const seen: string[] = []

    transport.subscribe(() => {
      throw new Error('bad handler')
    })
    transport.subscribe((json) => seen.push(json))

    transport.receive('{"a":1}')

    expect(seen).toEqual(['{"a":1}'])
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
