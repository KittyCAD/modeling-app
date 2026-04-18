import { computed, signal } from '@preact/signals-core'
import { describe, expect, it } from 'vitest'
import { appendFacet } from './facet'
import { defineExtension, provide } from './helpers'
import { ExtensionHost } from './host'

describe('facets', () => {
  it('orders by precedence', () => {
    const facet = appendFacet<string>('commands')
    const host = new ExtensionHost()

    host.configure([
      defineExtension({
        provides: [
          provide(facet, 'default-a'),
          provide(facet, 'highest', { precedence: 'highest' }),
          provide(facet, 'low', { precedence: 'low' }),
        ],
      }),
    ])

    expect(host.get(facet)).toEqual(['highest', 'default-a', 'low'])
  })

  it('dedupes by explicit key', () => {
    const facet = appendFacet<string>('toolbar')
    const host = new ExtensionHost()

    host.configure([
      defineExtension({
        provides: [
          provide(facet, 'a', { key: 'same' }),
          provide(facet, 'b', { key: 'same' }),
          provide(facet, 'c', { key: 'other' }),
        ],
      }),
    ])

    expect(host.get(facet)).toEqual(['a', 'c'])
  })

  it('debugFacet shows source metadata', () => {
    const facet = appendFacet<string>('toolbar')
    const live = signal('x')
    const host = new ExtensionHost()

    host.configure([
      defineExtension({
        provides: [
          provide(
            facet,
            computed(() => live.value),
            { key: 'x' }
          ),
        ],
      }),
    ])

    expect(host.debugFacet(facet).value[0]).toMatchObject({
      facetName: 'toolbar',
      sourcePath: 'root[0]',
      key: 'x',
      reactive: true,
    })
  })
})
