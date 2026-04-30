import { computed, signal } from '@preact/signals-core'
import { describe, expect, it, vi } from 'vitest'
import { appendSignal, mergeObjectsSignal } from './signal'
import { defineExtension, defineExtensionFactory, provide } from './helpers'
import { ExtensionHost } from './host'
import { Compartment } from './types'

describe('ExtensionHost', () => {
  it('resolves static and reactive signal contributions', () => {
    const itemsSignal = appendSignal<string>('items')
    const enabled = signal(true)

    const host = new ExtensionHost()
    host.configure([
      defineExtension({
        provides: [
          provide(itemsSignal, 'a'),
          provide(itemsSignal, signal('b')),
          provide(
            itemsSignal,
            computed(() => (enabled.value ? 'c' : 'hidden'))
          ),
        ],
      }),
    ])

    expect(host.get(itemsSignal)).toEqual(['a', 'b', 'c'])
    enabled.value = false
    expect(host.get(itemsSignal)).toEqual(['a', 'b', 'hidden'])
  })

  it('preserves runtime instances across unrelated compartment reconfiguration', () => {
    const calls = vi.fn()
    const extensionSignal = appendSignal<string>('values')
    const compartment = new Compartment()

    const runtime = defineExtensionFactory(() => {
      calls()
      return {
        extension: defineExtension({
          provides: [provide(extensionSignal, 'stable')],
        }),
      }
    }, 'stable-runtime')

    const host = new ExtensionHost()
    host.configure([
      runtime,
      compartment.of(
        defineExtension({ provides: [provide(extensionSignal, 'a')] })
      ),
    ])

    expect(host.get(extensionSignal)).toEqual(['stable', 'a'])
    expect(calls).toHaveBeenCalledTimes(1)

    host.reconfigure(compartment, [
      defineExtension({ provides: [provide(extensionSignal, 'b')] }),
    ])

    expect(host.get(extensionSignal)).toEqual(['stable', 'b'])
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it('merges object signals', () => {
    const settingsSignal = mergeObjectsSignal('settings', {
      theme: 'light',
      showSidebar: true,
    })
    const host = new ExtensionHost()

    host.configure([
      defineExtension({
        provides: [provide(settingsSignal, { theme: 'dark' })],
      }),
    ])

    expect(host.get(settingsSignal)).toEqual({
      theme: 'dark',
      showSidebar: true,
    })
  })
})
