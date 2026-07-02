import { computed, signal } from '@preact/signals-core'
import { describe, expect, it, vi } from 'vitest'
import {
  defineContract,
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
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

  it('activates runtime items after graph construction', async () => {
    const service = defineService<{ readonly id: string }>('workspace')
    const activate = vi.fn()
    const cleanup = vi.fn()
    const runtime = defineRegistryItemFactory(
      ({ services }) => ({
        item: defineRuntimeRegistryItem({
          activate: () => {
            activate(services.get(service).id)
            return cleanup
          },
        }),
      }),
      'runtime-with-activate'
    )
    const container = new Registry()

    container.configure([
      defineRegistryItem({
        providesServices: [provideService(service, { id: 'project' })],
      }),
      runtime,
    ])

    container.inspect()
    expect(activate).not.toHaveBeenCalled()

    await Promise.resolve()

    expect(activate).toHaveBeenCalledWith('project')

    container[Symbol.dispose]()
    expect(cleanup).toHaveBeenCalled()
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
})
