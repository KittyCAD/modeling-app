import { computed, signal } from '@preact/signals-core'
import { describe, expect, it } from 'vitest'
import { appendSignal } from './signal'
import { defineExtension, provide } from './helpers'
import { ExtensionContainer } from './container'

describe('signals', () => {
  it('orders by precedence', () => {
    const extensionSignal = appendSignal<string>('commands')
    const container = new ExtensionContainer()

    container.configure([
      defineExtension({
        provides: [
          provide(extensionSignal, 'default-a'),
          provide(extensionSignal, 'highest', { precedence: 'highest' }),
          provide(extensionSignal, 'low', { precedence: 'low' }),
        ],
      }),
    ])

    expect(container.get(extensionSignal)).toEqual([
      'highest',
      'default-a',
      'low',
    ])
  })

  it('dedupes by explicit key', () => {
    const extensionSignal = appendSignal<string>('toolbar')
    const container = new ExtensionContainer()

    container.configure([
      defineExtension({
        provides: [
          provide(extensionSignal, 'a', { key: 'same' }),
          provide(extensionSignal, 'b', { key: 'same' }),
          provide(extensionSignal, 'c', { key: 'other' }),
        ],
      }),
    ])

    expect(container.get(extensionSignal)).toEqual(['a', 'c'])
  })

  it('debugSignal shows source metadata', () => {
    const extensionSignal = appendSignal<string>('toolbar')
    const live = signal('x')
    const container = new ExtensionContainer()

    container.configure([
      defineExtension({
        provides: [
          provide(
            extensionSignal,
            computed(() => live.value),
            { key: 'x' }
          ),
        ],
      }),
    ])

    expect(container.debugSignal(extensionSignal).value[0]).toMatchObject({
      signalName: 'toolbar',
      sourcePath: 'root[0]',
      key: 'x',
      reactive: true,
    })
  })
})
