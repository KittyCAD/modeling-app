import { computed, signal } from '@preact/signals-core'
import { describe, expect, it } from 'vitest'
import { appendSignal } from './signal'
import { defineRegistryItem, provide } from './helpers'
import { Registry } from './registry'

describe('signals', () => {
  it('orders by precedence', () => {
    const registrySignal = appendSignal<string>('commands')
    const container = new Registry()

    container.configure([
      defineRegistryItem({
        provides: [
          provide(registrySignal, 'default-a'),
          provide(registrySignal, 'highest', { precedence: 'highest' }),
          provide(registrySignal, 'low', { precedence: 'low' }),
        ],
      }),
    ])

    expect(container.get(registrySignal)).toEqual([
      'highest',
      'default-a',
      'low',
    ])
  })

  it('dedupes by explicit key', () => {
    const registrySignal = appendSignal<string>('toolbar')
    const container = new Registry()

    container.configure([
      defineRegistryItem({
        provides: [
          provide(registrySignal, 'a', { key: 'same' }),
          provide(registrySignal, 'b', { key: 'same' }),
          provide(registrySignal, 'c', { key: 'other' }),
        ],
      }),
    ])

    expect(container.get(registrySignal)).toEqual(['a', 'c'])
  })

  it('debugSignal shows source metadata', () => {
    const registrySignal = appendSignal<string>('toolbar')
    const live = signal('x')
    const container = new Registry()

    container.configure([
      defineRegistryItem({
        provides: [
          provide(
            registrySignal,
            computed(() => live.value),
            { key: 'x' }
          ),
        ],
      }),
    ])

    expect(container.debugSignal(registrySignal).value[0]).toMatchObject({
      signalName: 'toolbar',
      sourcePath: 'root[0]',
      key: 'x',
      reactive: true,
    })
  })
})
