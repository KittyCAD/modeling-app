import { computed, signal } from '@preact/signals-core'
import { act, render, screen } from '@testing-library/react'
import { createElement, Suspense, use } from 'react'
import { describe, expect, it } from 'vitest'
import { defineRegistryItem, provide } from './helpers'
import { Registry } from './registry'
import { Slot } from './types'
import { appendValueSpec, firstWinsValueSpec } from './valueSpec'

describe('value specs', () => {
  it('preserves a real React-consumed promise across registry reconfiguration', async () => {
    const promise = Promise.resolve('loaded')
    const promiseSpec = firstWinsValueSpec<Promise<string> | undefined>(
      'promise',
      undefined
    )
    const slot = new Slot()
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({ provides: [provide(promiseSpec, promise)] }),
      slot.of(),
    ])
    const observed: Array<Promise<string> | undefined> = []
    const unsubscribe = registry.signal(promiseSpec).subscribe((value) => {
      observed.push(value)
    })
    function Consumer() {
      return createElement('span', null, use(promise))
    }
    let view: ReturnType<typeof render> | undefined
    try {
      await act(async () => {
        view = render(
          createElement(
            Suspense,
            { fallback: 'loading' },
            createElement(Consumer)
          )
        )
        await promise
      })
      expect(screen.getByText('loaded')).toBeTruthy()
      // React itself decorates the fulfilled promise with .value. An unrelated
      // registry update must not reinterpret that promise as a Preact signal.
      registry.reconfigure(slot, [defineRegistryItem({ id: 'unrelated' })])
      expect(registry.get(promiseSpec)).toBe(promise)
      expect(observed).toEqual([promise])
    } finally {
      view?.unmount()
      unsubscribe()
      registry[Symbol.dispose]()
    }
  })

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
