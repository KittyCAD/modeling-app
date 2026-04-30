import { computed, signal } from '@preact/signals-core'
import { describe, expect, it, vi } from 'vitest'
import { appendSignal, mergeObjectsSignal } from './signal'
import { defineExtension, defineExtensionFactory, provide } from './helpers'
import { ExtensionContainer } from './container'
import { Slot } from './types'

describe('ExtensionContainer', () => {
  it('resolves static and reactive signal contributions', () => {
    const itemsSignal = appendSignal<string>('items')
    const enabled = signal(true)

    const container = new ExtensionContainer()
    container.configure([
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

    expect(container.get(itemsSignal)).toEqual(['a', 'b', 'c'])
    enabled.value = false
    expect(container.get(itemsSignal)).toEqual(['a', 'b', 'hidden'])
  })

  it('preserves runtime instances across unrelated slot reconfiguration', () => {
    const calls = vi.fn()
    const extensionSignal = appendSignal<string>('values')
    const slot = new Slot()

    const runtime = defineExtensionFactory(() => {
      calls()
      return {
        extension: defineExtension({
          provides: [provide(extensionSignal, 'stable')],
        }),
      }
    }, 'stable-runtime')

    const container = new ExtensionContainer()
    container.configure([
      runtime,
      slot.of(defineExtension({ provides: [provide(extensionSignal, 'a')] })),
    ])

    expect(container.get(extensionSignal)).toEqual(['stable', 'a'])
    expect(calls).toHaveBeenCalledTimes(1)

    container.reconfigure(slot, [
      defineExtension({ provides: [provide(extensionSignal, 'b')] }),
    ])

    expect(container.get(extensionSignal)).toEqual(['stable', 'b'])
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it('merges object signals', () => {
    const settingsSignal = mergeObjectsSignal('settings', {
      theme: 'light',
      showSidebar: true,
    })
    const container = new ExtensionContainer()

    container.configure([
      defineExtension({
        provides: [provide(settingsSignal, { theme: 'dark' })],
      }),
    ])

    expect(container.get(settingsSignal)).toEqual({
      theme: 'dark',
      showSidebar: true,
    })
  })
})
