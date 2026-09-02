import { computed, signal } from '@preact/signals-core'
import { describe, expect, it, vi } from 'vitest'
import {
  defineContract,
  defineRegistryItem,
  defineRegistryItemFactory,
  provide,
  provideService,
} from './helpers'
import { Registry } from './registry'
import { defineService } from './service'
import { type RegistryItem, Slot } from './types'
import {
  appendValueSpec,
  firstWinsValueSpec,
  mergeObjectsValueSpec,
} from './valueSpec'

function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

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

  it('supports contract-style decoupling between provider and consumer registry items', () => {
    /**
     * In real app code, these tokens would live in a small "contract" module.
     *
     * - `weather.contract.ts` exports only the ValueSpecs and Services
     * - `weather.provider.ts` imports the contract and provides implementations
     * - `weather.consumer.ts` imports the contract and consumes it
     *
     * That way, downstream items depend on the contract, not on the provider's
     * concrete registry item module.
     */
    const weatherContract = defineContract({
      currentTemperatureValueSpec: firstWinsValueSpec<number>(
        'weather.current-temperature',
        0
      ),
      weatherSummaryService: defineService<{ readonly summary: string }>(
        'weather.summary'
      ),
    })
    const dashboardValueSpec = firstWinsValueSpec<string>(
      'dashboard.weather',
      'Weather unavailable'
    )

    const weatherProviderItem = defineRegistryItem({
      id: 'weather.provider',
      provides: [provide(weatherContract.currentTemperatureValueSpec, 72)],
      providesServices: [
        provideService(weatherContract.weatherSummaryService, {
          summary: 'Sunny',
        }),
      ],
    })

    const weatherConsumerItem = defineRegistryItemFactory(
      ({ valueSpecs, services }) => {
        return {
          item: defineRegistryItem({
            id: 'weather.consumer',
            provides: [
              provide(
                dashboardValueSpec,
                computed(() => {
                  const weather = services.optional(
                    weatherContract.weatherSummaryService
                  )
                  const temperature = valueSpecs.get(
                    weatherContract.currentTemperatureValueSpec
                  )

                  return weather
                    ? `${weather.summary} ${temperature}F`
                    : 'Weather unavailable'
                })
              ),
            ],
          }),
        }
      },
      'weather.consumer'
    )

    const container = new Registry()

    // Runtime registry order is not the problem here. The consumer can appear
    // before the provider because it depends on the shared contract tokens, not
    // on the provider item itself.
    container.configure([weatherConsumerItem, weatherProviderItem])

    expect(container.get(dashboardValueSpec)).toBe('Sunny 72F')
  })

  it('dedupes cyclic declarative dependencies by stable ids and stays lazy for unreachable runtime items', () => {
    const visitedValueSpec = appendValueSpec<string>('visited')
    const unreachableCalls = vi.fn()

    const itemA = defineRegistryItem({
      id: 'cycle.a',
      provides: [provide(visitedValueSpec, 'a')],
      uses: [],
    })
    const itemB = defineRegistryItem({
      id: 'cycle.b',
      provides: [provide(visitedValueSpec, 'b')],
      uses: [itemA],
    })

    // Close the cycle after both items exist.
    ;(itemA.uses as RegistryItem[]).push(itemB)

    const _unreachableRuntimeItem = defineRegistryItemFactory(() => {
      unreachableCalls()
      return {
        item: defineRegistryItem({
          id: 'unreachable.runtime',
          provides: [provide(visitedValueSpec, 'unreachable')],
        }),
      }
    }, 'unreachable.runtime')

    const container = new Registry()
    container.configure([itemA])

    expect(container.get(visitedValueSpec)).toEqual(['a', 'b'])
    expect(unreachableCalls).not.toHaveBeenCalled()
  })

  it('removes an unmounted runtime immediately and awaits its async finalizer', async () => {
    const values = appendValueSpec<string>('async-disposal.values')
    const slot = new Slot()
    const release = deferred()
    const events: string[] = []
    const runtime = defineRegistryItemFactory(() => {
      return {
        item: {
          provides: [provide(values, 'mounted')],
          dispose: async () => {
            events.push('dispose:start')
            await release.promise
            events.push('dispose:end')
          },
        },
      }
    }, 'async-disposal.runtime')
    const container = new Registry()
    container.configure([slot.of(runtime)])
    expect(container.get(values)).toEqual(['mounted'])

    const disposed = container.reconfigureAsync(slot, [])
    expect(container.get(values)).toEqual([])
    expect(container.inspect().runtimeInstanceCount).toBe(0)
    await vi.waitFor(() => expect(events).toEqual(['dispose:start']))

    release.resolve()
    await disposed
    expect(events).toEqual(['dispose:start', 'dispose:end'])
  })

  it('starts synchronous finalizers immediately through the legacy API', () => {
    const slot = new Slot()
    const events: string[] = []
    const child = defineRegistryItemFactory(() => {
      return { item: { dispose: () => events.push('child') } }
    }, 'sync-disposal.child')
    const parent = defineRegistryItemFactory(() => {
      return {
        item: {
          uses: [child],
          dispose: () => events.push('parent'),
        },
      }
    }, 'sync-disposal.parent')
    const container = new Registry()
    container.configure([slot.of(parent)])
    container.inspect()

    container.reconfigure(slot, [])

    expect(events).toEqual(['child', 'parent'])
  })

  it('deactivates every runtime before awaiting asynchronous finalizers', async () => {
    const slot = new Slot()
    const release = deferred()
    const events: string[] = []
    const synchronous = defineRegistryItemFactory(() => {
      return { item: { dispose: () => events.push('sync') } }
    }, 'mixed-disposal.sync')
    const asynchronous = defineRegistryItemFactory(() => {
      return {
        item: {
          dispose: async () => {
            events.push('async:start')
            await release.promise
            events.push('async:end')
          },
        },
      }
    }, 'mixed-disposal.async')
    const container = new Registry()
    container.configure([slot.of(synchronous, asynchronous)])
    container.inspect()

    const disposed = container.reconfigureAsync(slot, [])

    expect(events).toEqual(['async:start', 'sync'])
    release.resolve()
    await disposed
    expect(events).toEqual(['async:start', 'sync', 'async:end'])
  })

  it('disposes dependent runtime instances before their providers', async () => {
    const events: string[] = []
    const child = defineRegistryItemFactory(() => {
      return {
        item: {
          dispose: async () => {
            events.push('child')
          },
        },
      }
    }, 'async-disposal.child')
    const parent = defineRegistryItemFactory(() => {
      return {
        item: {
          uses: [child],
          dispose: async () => {
            events.push('parent')
          },
        },
      }
    }, 'async-disposal.parent')
    const container = new Registry()
    container.configure([parent])
    container.inspect()

    await container.configureAsync([])

    expect(events).toEqual(['child', 'parent'])
  })

  it('runs every finalizer, aggregates failures, and keeps later cleanup healthy', async () => {
    const firstFailure = new Error('first cleanup failed')
    const secondFailure = new Error('second cleanup failed')
    const events: string[] = []
    const failingRuntime = (id: string, failure: Error) =>
      defineRegistryItemFactory(() => {
        return {
          item: {
            dispose: async () => {
              events.push(id)
              return Promise.reject(failure)
            },
          },
        }
      }, id)
    const healthyRuntime = defineRegistryItemFactory(() => {
      return {
        item: {
          dispose: async () => {
            events.push('healthy')
          },
        },
      }
    }, 'async-disposal.healthy')
    const container = new Registry()
    container.configure([
      failingRuntime('first', firstFailure),
      failingRuntime('second', secondFailure),
    ])
    container.inspect()

    const failed = container.configureAsync([])
    await expect(failed).rejects.toEqual(
      expect.objectContaining({
        name: 'AggregateError',
        errors: [secondFailure, firstFailure],
      })
    )
    expect(events).toEqual(['second', 'first'])

    await container.configureAsync([healthyRuntime])
    await container.configureAsync([])
    expect(events).toEqual(['second', 'first', 'healthy'])
  })

  it('supports native awaited container disposal', async () => {
    const release = deferred()
    const events: string[] = []
    const runtime = defineRegistryItemFactory(() => {
      return {
        item: {
          dispose: {
            async [Symbol.asyncDispose]() {
              events.push('dispose:start')
              await release.promise
              events.push('dispose:end')
            },
          },
        },
      }
    }, 'async-disposal.protocol')
    const container = new Registry()
    container.configure([runtime])
    container.inspect()

    const disposed = container[Symbol.asyncDispose]()
    await vi.waitFor(() => expect(events).toEqual(['dispose:start']))
    release.resolve()
    await disposed

    expect(events).toEqual(['dispose:start', 'dispose:end'])
    expect(container.inspect().runtimeInstanceCount).toBe(0)
  })
})
