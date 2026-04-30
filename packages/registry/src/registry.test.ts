import { computed, signal } from '@preact/signals-core'
import { describe, expect, it, vi } from 'vitest'
import { appendValueSpec, mergeObjectsValueSpec } from './valueSpec'
import {
  defineRegistryItem,
  defineRegistryItemFactory,
  provide,
} from './helpers'
import { Registry } from './registry'
import { Slot } from './types'

describe('Registry', () => {
  it('resolves static and reactive value-spec contributions', () => {
    const itemsSignal = appendValueSpec<string>('items')
    const enabled = signal(true)

    const container = new Registry()
    container.configure([
      defineRegistryItem({
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
    const registrySignal = appendValueSpec<string>('values')
    const slot = new Slot()

    const runtime = defineRegistryItemFactory(() => {
      calls()
      return {
        item: defineRegistryItem({
          provides: [provide(registrySignal, 'stable')],
        }),
      }
    }, 'stable-runtime')

    const container = new Registry()
    container.configure([
      runtime,
      slot.of(defineRegistryItem({ provides: [provide(registrySignal, 'a')] })),
    ])

    expect(container.get(registrySignal)).toEqual(['stable', 'a'])
    expect(calls).toHaveBeenCalledTimes(1)

    container.reconfigure(slot, [
      defineRegistryItem({ provides: [provide(registrySignal, 'b')] }),
    ])

    expect(container.get(registrySignal)).toEqual(['stable', 'b'])
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it('merges object value specs', () => {
    const settingsValueSpec = mergeObjectsValueSpec('settings', {
      theme: 'light',
      showSidebar: true,
    })
    const container = new Registry()

    container.configure([
      defineRegistryItem({
        provides: [provide(settingsValueSpec, { theme: 'dark' })],
      }),
    ])

    expect(container.get(settingsValueSpec)).toEqual({
      theme: 'dark',
      showSidebar: true,
    })
  })
})
