import { computed, signal } from '@preact/signals-core'
import { describe, expect, it, vi } from 'vitest'
import { RegistryDependencyError, ServiceResolutionError } from './errors'
import { defineRegistryItemFactory, provide, provideService } from './helpers'
import { Registry } from './registry'
import { defineService } from './service'
import { Slot, type RegistryItem } from './types'
import { appendValueSpec } from './valueSpec'

describe('factory dependencies', () => {
  it('plans prerequisites before lazy callbacks and keeps the first factory identity', async () => {
    const service = defineService<{ read(): string }>('files')
    const result = defineService<{ read(): string }>('result')
    const events: string[] = []
    const provider = defineRegistryItemFactory(() => {
      events.push('provider')
      return {
        providesServices: [provideService(service, { read: () => 'loaded' })],
        dispose: () => {
          events.push('dispose provider')
        },
      }
    }, 'provider')
    const unusedDependency = defineRegistryItemFactory(() => {
      events.push('unused dependency')
      return {}
    })
    const duplicate = defineRegistryItemFactory(
      () => {
        events.push('duplicate')
        return {}
      },
      'provider',
      [unusedDependency]
    )
    const consumer = defineRegistryItemFactory(
      ({ services }) => {
        events.push('consumer')
        return {
          providesServices: [
            provideService(result, {
              read: () => services.get(service).read(),
            }),
          ],
          dispose: () => {
            events.push('dispose consumer')
          },
        }
      },
      'consumer',
      [provider]
    )
    const container = new Registry()
    container.configure([consumer, duplicate, consumer, provider])
    expect(events).toEqual([])
    expect(container.get(result).read()).toBe('loaded')
    expect(events).toEqual(['provider', 'consumer'])
    container.inspect()
    expect(events).toEqual(['provider', 'consumer'])
    await container.disposeAsync()
    expect(events.slice(2)).toEqual(['dispose consumer', 'dispose provider'])
  })

  it('shares the same construction rules with and without dependencies', () => {
    const service = defineService<{ ok: boolean }>('service')
    const provider = {
      providesServices: [provideService(service, { ok: true })],
    }
    for (const dependencies of [[], [provider]]) {
      const container = new Registry()
      const consumer = defineRegistryItemFactory(
        ({ services }) => {
          services.get(service)
          return {}
        },
        'consumer',
        dependencies
      )
      container.configure([provider, consumer])
      expect(() => container.inspect()).toThrow(ServiceResolutionError)
    }
  })

  it('keeps the first declarative item and does not run a losing subtree', () => {
    const values = appendValueSpec<string>('values')
    const unused = vi.fn()
    const original = { id: 'provider', provides: [provide(values, 'original')] }
    const duplicate = {
      id: 'provider',
      provides: [provide(values, 'duplicate')],
      uses: [
        defineRegistryItemFactory(() => {
          unused()
          return {}
        }),
      ],
    }
    const consumer = defineRegistryItemFactory(() => ({}), 'consumer', [
      duplicate,
    ])
    const container = new Registry()
    container.configure([original, consumer])
    expect(container.get(values)).toEqual(['original'])
    expect(unused).not.toHaveBeenCalled()
  })

  it('normalizes returned items without running children of a discarded duplicate', () => {
    const unused = vi.fn()
    const values = appendValueSpec<string>('values')
    const first = defineRegistryItemFactory(() => ({
      id: 'shared',
      provides: [provide(values, 'first')],
    }))
    const duplicate = {
      id: 'shared',
      provides: [provide(values, 'second')],
      uses: [
        defineRegistryItemFactory(() => {
          unused()
          return {}
        }),
      ],
    }
    const container = new Registry()
    container.configure([first, duplicate])
    expect(container.get(values)).toEqual(['first'])
    expect(unused).not.toHaveBeenCalled()
  })

  it('plans a full dependency chain before executing it in order', () => {
    const events: string[] = []
    const first = defineRegistryItemFactory(() => {
      events.push('first')
      return {}
    })
    const second = defineRegistryItemFactory(
      () => {
        events.push('second')
        return {}
      },
      'second',
      [first]
    )
    const third = defineRegistryItemFactory(
      () => {
        events.push('third')
        return {}
      },
      'third',
      [second]
    )
    const container = new Registry()
    container.configure([third, second, first])
    expect(events).toEqual([])
    container.inspect()
    expect(events).toEqual(['first', 'second', 'third'])
  })

  it('rejects known dependency cycles before running any callbacks', () => {
    const called = vi.fn()
    const children: RegistryItem[] = []
    const first = defineRegistryItemFactory(
      () => {
        called()
        return {}
      },
      'first',
      [{ uses: children }]
    )
    const second = defineRegistryItemFactory(
      () => {
        called()
        return {}
      },
      'second',
      [first]
    )
    children.push(second)
    const unrelated = defineRegistryItemFactory(() => {
      called()
      return {}
    })
    const container = new Registry()
    container.configure([unrelated, first])
    expect(() => container.inspect()).toThrow(RegistryDependencyError)
    expect(called).not.toHaveBeenCalled()
  })

  it('preserves callbacks across dependency replacement and lets live reads follow the graph', async () => {
    const service = defineService<{ name: string }>('provider')
    const output = defineService<{ name(): string | undefined }>('consumer')
    const slot = new Slot()
    const unrelated = new Slot()
    const calls = vi.fn()
    const events: string[] = []
    const provider = (name: string) =>
      defineRegistryItemFactory(
        () => ({
          providesServices: [provideService(service, { name })],
          dispose: () => {
            events.push(`provider:${name}`)
          },
        }),
        `provider:${name}`
      )
    const consumer = defineRegistryItemFactory(
      ({ services }) => {
        calls()
        const live = services.signal(service)
        return {
          providesServices: [
            provideService(output, { name: () => live.value?.name }),
          ],
          dispose: () => {
            events.push('consumer')
          },
        }
      },
      'consumer',
      [slot.of(provider('one'))]
    )
    const container = new Registry()
    container.configure([consumer, unrelated.of()])
    const original = container.get(output)
    expect(original.name()).toBe('one')
    await container.reconfigureAsync(unrelated, [{}])
    await container.reconfigureAsync(slot, [provider('two')])
    expect(container.get(output)).toBe(original)
    expect(original.name()).toBe('two')
    expect(calls).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['provider:one'])
    await container.configureAsync([])
    expect(events.slice(1)).toEqual(['consumer', 'provider:two'])
  })

  it('keeps value-spec signals live without rerunning callbacks', () => {
    const values = appendValueSpec<string>('values')
    const output = defineService<{ values(): readonly string[] }>('output')
    const source = signal('one')
    const calls = vi.fn()
    const consumer = defineRegistryItemFactory(
      ({ valueSpecs }) => {
        calls()
        const live = valueSpecs.signal(values)
        return {
          provides: [
            provide(
              values,
              computed(() => source.value.toUpperCase())
            ),
          ],
          providesServices: [
            provideService(output, { values: () => live.value }),
          ],
        }
      },
      'consumer',
      [{ provides: [provide(values, source)] }]
    )
    const container = new Registry()
    container.configure([consumer])
    expect(container.get(output).values()).toEqual(['one', 'ONE'])
    source.value = 'two'
    expect(container.get(output).values()).toEqual(['two', 'TWO'])
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it('disposes dependents first through synchronous disposal', () => {
    const events: string[] = []
    const dependency = defineRegistryItemFactory(() => ({
      dispose: () => {
        events.push('dependency')
      },
    }))
    const consumer = defineRegistryItemFactory(
      () => ({
        dispose: () => {
          events.push('consumer')
        },
      }),
      'consumer',
      [dependency]
    )
    const container = new Registry()
    container.configure([consumer])
    container.inspect()
    container[Symbol.dispose]()
    expect(events).toEqual(['consumer', 'dependency'])
  })

  it('cleans up failed construction and retries through the normal callback path', async () => {
    const events: string[] = []
    const provider = defineRegistryItemFactory(() => {
      events.push('create')
      return {
        dispose: () => {
          events.push('dispose')
        },
      }
    })
    const broken = defineRegistryItemFactory(
      () => {
        throw new Error('setup failed')
      },
      'broken',
      [provider]
    )
    const container = new Registry()
    container.configure([broken])
    expect(() => container.inspect()).toThrow('setup failed')
    expect(events).toEqual(['create', 'dispose'])
    await container.configureAsync([provider])
    expect(events).toEqual(['create', 'dispose', 'create'])
    await container.disposeAsync()
  })
})
