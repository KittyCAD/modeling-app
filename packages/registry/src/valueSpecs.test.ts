import { computed, signal } from '@preact/signals-core'
import { describe, expect, it } from 'vitest'
import { defineRegistryItem, provide } from './helpers'
import { Registry } from './registry'
import { appendValueSpec } from './valueSpec'

describe('value specs', () => {
  it('orders by precedence', () => {
    const registrySignal = appendValueSpec<string>('commands')
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
    const registrySignal = appendValueSpec<string>('toolbar')
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

  it('debugValueSpec shows source metadata', () => {
    const registrySignal = appendValueSpec<string>('toolbar')
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

    expect(container.debugValueSpec(registrySignal).value[0]).toMatchObject({
      valueSpecName: 'toolbar',
      sourcePath: 'root[0]',
      key: 'x',
      reactive: true,
    })
  })
})
