import { computed, signal } from '@preact/signals-core'
import { describe, expect, it, vi } from 'vitest'
import { appendFacet, mergeObjectsFacet } from './facet'
import { defineExtension, defineExtensionFactory, provide } from './helpers'
import { ExtensionHost } from './host'
import { Compartment } from './types'

describe('ExtensionHost', () => {
  it('resolves static and reactive facet contributions', () => {
    const itemsFacet = appendFacet<string>('items')
    const enabled = signal(true)

    const host = new ExtensionHost()
    host.configure([
      defineExtension({
        provides: [
          provide(itemsFacet, 'a'),
          provide(itemsFacet, signal('b')),
          provide(
            itemsFacet,
            computed(() => (enabled.value ? 'c' : 'hidden'))
          ),
        ],
      }),
    ])

    expect(host.get(itemsFacet)).toEqual(['a', 'b', 'c'])
    enabled.value = false
    expect(host.get(itemsFacet)).toEqual(['a', 'b', 'hidden'])
  })

  it('preserves runtime instances across unrelated compartment reconfiguration', () => {
    const calls = vi.fn()
    const facet = appendFacet<string>('values')
    const compartment = new Compartment()

    const runtime = defineExtensionFactory(() => {
      calls()
      return {
        extension: defineExtension({
          provides: [provide(facet, 'stable')],
        }),
      }
    }, 'stable-runtime')

    const host = new ExtensionHost()
    host.configure([
      runtime,
      compartment.of(defineExtension({ provides: [provide(facet, 'a')] })),
    ])

    expect(host.get(facet)).toEqual(['stable', 'a'])
    expect(calls).toHaveBeenCalledTimes(1)

    host.reconfigure(compartment, [
      defineExtension({ provides: [provide(facet, 'b')] }),
    ])

    expect(host.get(facet)).toEqual(['stable', 'b'])
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it('merges object facets', () => {
    const settingsFacet = mergeObjectsFacet('settings', {
      theme: 'light',
      showSidebar: true,
    })
    const host = new ExtensionHost()

    host.configure([
      defineExtension({
        provides: [provide(settingsFacet, { theme: 'dark' })],
      }),
    ])

    expect(host.get(settingsFacet)).toEqual({
      theme: 'dark',
      showSidebar: true,
    })
  })
})
