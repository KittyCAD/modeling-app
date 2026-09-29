import { computed, signal, type ReadonlySignal } from '@preact/signals-core'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  MissingServiceError,
  RegistryDependencyError,
  ServiceResolutionError,
} from './errors'
import { defineRegistryItemFactory, provide, provideService } from './helpers'
import { Registry } from './registry'
import { defineService } from './service'
import { Slot, type RegistryItem } from './types'
import { appendValueSpec, defineValueSpec } from './valueSpec'

const dependencyToken = appendValueSpec<boolean>('dependency')
const marker = () => [provide(dependencyToken, true)]

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
      return { provides: marker() }
    })
    const duplicate = defineRegistryItemFactory({
      id: 'provider',
      dependencies: {
        unused: { registryItem: unusedDependency, token: dependencyToken },
      },
      create() {
        events.push('duplicate')
        return {}
      },
    })
    const consumer = defineRegistryItemFactory({
      id: 'consumer',
      dependencies: { files: { registryItem: provider, token: service } },
      create({ files }) {
        events.push('consumer')
        return {
          providesServices: [
            provideService(result, { read: () => files.value.read() }),
          ],
          dispose: () => {
            events.push('dispose consumer')
          },
        }
      },
    })
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

  it('keeps injected service reads lazy like the callback form', () => {
    const service = defineService<{ ok: boolean }>('service')
    const provider = {
      providesServices: [provideService(service, { ok: true })],
    }
    const consumers = [
      defineRegistryItemFactory(({ services }) => {
        services.get(service)
        return {}
      }),
      defineRegistryItemFactory({
        dependencies: { required: { registryItem: provider, token: service } },
        create({ required }) {
          void required.value
          return {}
        },
      }),
    ]
    for (const consumer of consumers) {
      const container = new Registry()
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
    const consumer = defineRegistryItemFactory({
      id: 'consumer',
      dependencies: { values: { registryItem: duplicate, token: values } },
      create: () => ({}),
    })
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
      return { provides: marker() }
    })
    const second = defineRegistryItemFactory({
      id: 'second',
      dependencies: { first: { registryItem: first, token: dependencyToken } },
      create() {
        events.push('second')
        return { provides: marker() }
      },
    })
    const third = defineRegistryItemFactory({
      id: 'third',
      dependencies: {
        second: { registryItem: second, token: dependencyToken },
      },
      create() {
        events.push('third')
        return {}
      },
    })
    const container = new Registry()
    container.configure([third, second, first])
    expect(events).toEqual([])
    container.inspect()
    expect(events).toEqual(['first', 'second', 'third'])
  })

  it('rejects known dependency cycles before running any callbacks', () => {
    const called = vi.fn()
    const children: RegistryItem[] = []
    const first = defineRegistryItemFactory({
      id: 'first',
      dependencies: {
        children: { registryItem: { uses: children }, token: dependencyToken },
      },
      create() {
        called()
        return {}
      },
    })
    const second = defineRegistryItemFactory({
      id: 'second',
      dependencies: { first: { registryItem: first, token: dependencyToken } },
      create() {
        called()
        return {}
      },
    })
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

  it('preserves callbacks across dependency replacement and lets required signals follow the graph', async () => {
    const service = defineService<{ name: string }>('provider')
    const output = defineService<{ name(): string }>('consumer')
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
    const consumer = defineRegistryItemFactory({
      id: 'consumer',
      dependencies: {
        live: { registryItem: slot.of(provider('one')), token: service },
      },
      create({ live }) {
        calls()
        return {
          providesServices: [
            provideService(output, { name: () => live.value.name }),
          ],
          dispose: () => {
            events.push('consumer')
          },
        }
      },
    })
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
    expect(() => original.name()).toThrow(MissingServiceError)
  })

  it('keeps value-spec signals live and includes all contributors without rerunning callbacks', () => {
    const values = appendValueSpec<string>('values')
    const output = defineService<{ values(): readonly string[] }>('output')
    const source = signal('one')
    const calls = vi.fn()
    const consumer = defineRegistryItemFactory({
      id: 'consumer',
      dependencies: {
        live: {
          registryItem: { provides: [provide(values, source)] },
          token: values,
        },
      },
      create({ live }) {
        calls()
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
    })
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
      provides: marker(),
      dispose: () => {
        events.push('dependency')
      },
    }))
    const consumer = defineRegistryItemFactory({
      id: 'consumer',
      dependencies: {
        dependency: { registryItem: dependency, token: dependencyToken },
      },
      create: () => ({
        dispose: () => {
          events.push('consumer')
        },
      }),
    })
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
        provides: marker(),
        dispose: () => {
          events.push('dispose')
        },
      }
    })
    const broken = defineRegistryItemFactory({
      id: 'broken',
      dependencies: {
        provider: { registryItem: provider, token: dependencyToken },
      },
      create() {
        throw new Error('setup failed')
      },
    })
    const container = new Registry()
    container.configure([broken])
    expect(() => container.inspect()).toThrow('setup failed')
    expect(events).toEqual(['create', 'dispose'])
    await container.configureAsync([provider])
    expect(events).toEqual(['create', 'dispose', 'create'])
    await container.disposeAsync()
  })

  it('infers required service and combined output types, and exposes only named inputs', () => {
    const files = defineService<{ read(): string }>('files')
    const count = defineValueSpec<string, number>({
      name: 'count',
      defaultValue: 0,
      combine: (inputs) => inputs.length,
    })
    const provider = {
      providesServices: [provideService(files, { read: () => 'file' })],
      provides: [provide(count, 'one')],
    }
    let read: (() => string) | undefined
    const create = vi.fn()
    const consumer = defineRegistryItemFactory({
      dependencies: {
        files: { registryItem: provider, token: files },
        count: { registryItem: provider, token: count },
      },
      create(inputs) {
        expectTypeOf(inputs.files).toEqualTypeOf<
          ReadonlySignal<{ read(): string }>
        >()
        expectTypeOf(inputs.count).toEqualTypeOf<ReadonlySignal<number>>()
        expectTypeOf<keyof typeof inputs>().toEqualTypeOf<'files' | 'count'>()
        // @ts-expect-error An undeclared registry context is not available.
        void inputs.services
        expect(Object.keys(inputs)).toEqual(['files', 'count'])
        create()
        read = () => `${inputs.files.value.read()}:${inputs.count.value}`
        return {}
      },
    })
    const container = new Registry()
    container.configure([consumer])
    container.inspect()
    expect(read?.()).toBe('file:1')
    expect(create).toHaveBeenCalledTimes(1)

    defineRegistryItemFactory({
      dependencies: {
        // @ts-expect-error Both the registry item and the token are required.
        missingItem: { token: files },
      },
      create: () => ({}),
    })
    defineRegistryItemFactory({
      dependencies: {
        // @ts-expect-error A token cannot be replaced with a registry item.
        invalidToken: { registryItem: provider, token: provider },
      },
      create: () => ({}),
    })
  })

  it.each(['service', 'valueSpec'] as const)(
    'rejects mismatched %s pairs even if another item provides the token',
    async (kind) => {
      const service = defineService<{ ok: boolean }>('files')
      const values = appendValueSpec<string>('settings')
      const token = kind === 'service' ? service : values
      const disposed = vi.fn()
      const create = vi.fn(() => ({}))
      const wrongProvider = defineRegistryItemFactory(
        () => ({ dispose: disposed }),
        'wrong-provider'
      )
      const consumer = defineRegistryItemFactory({
        id: 'consumer',
        dependencies: { required: { registryItem: wrongProvider, token } },
        create,
      })
      const container = new Registry()
      container.configure([
        {
          providesServices: [provideService(service, { ok: true })],
          provides: [provide(values, 'setting')],
        },
        consumer,
      ])
      expect(() => container.inspect()).toThrow(
        `Factory consumer dependency "required" does not provide token "${token.name}"`
      )
      expect(create).not.toHaveBeenCalled()
      expect(disposed).toHaveBeenCalledTimes(1)
      await container.configureAsync([])
      expect(container.inspect().runtimeInstanceCount).toBe(0)
    }
  )

  it('checks the winning instance rather than trusting a discarded provider', () => {
    const service = defineService<{ ok: boolean }>('files')
    const first = { id: 'provider' }
    const discarded = {
      id: 'provider',
      providesServices: [provideService(service, { ok: true })],
    }
    const create = vi.fn(() => ({}))
    const consumer = defineRegistryItemFactory({
      dependencies: { files: { registryItem: discarded, token: service } },
      create,
    })
    const container = new Registry()
    container.configure([first, consumer])
    expect(() => container.inspect()).toThrow(RegistryDependencyError)
    expect(create).not.toHaveBeenCalled()
  })

  it('accepts tokens provided by a nested factory and shares it between named dependencies', () => {
    const service = defineService<{ ok: boolean }>('files')
    const create = vi.fn(() => ({
      providesServices: [provideService(service, { ok: true })],
    }))
    const child = defineRegistryItemFactory(create)
    let read: (() => boolean) | undefined
    const consumer = defineRegistryItemFactory({
      dependencies: {
        first: { registryItem: { uses: [child] }, token: service },
        second: { registryItem: child, token: service },
      },
      create({ first, second }) {
        read = () => first.value === second.value
        return {}
      },
    })
    const container = new Registry()
    container.configure([consumer])
    container.inspect()
    expect(read?.()).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('revalidates cached consumers when a dependency slot loses its provider', async () => {
    const service = defineService<{ ok: boolean }>('files')
    const slot = new Slot()
    const provider = {
      providesServices: [provideService(service, { ok: true })],
    }
    const create = vi.fn(() => ({}))
    const consumer = defineRegistryItemFactory({
      dependencies: {
        files: { registryItem: slot.of(provider), token: service },
      },
      create,
    })
    const container = new Registry()
    container.configure([consumer])
    container.inspect()
    container.reconfigure(slot, [])
    expect(() => container.inspect()).toThrow(RegistryDependencyError)
    await container.reconfigureAsync(slot, [provider])
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('keeps ordinary service signals optional for toggleable providers', async () => {
    const service = defineService<{ ok: boolean }>('optional')
    const container = new Registry()
    const live = container.signal(service)
    expectTypeOf(live).toEqualTypeOf<
      ReadonlySignal<{ ok: boolean } | undefined>
    >()
    expect(live.value).toBeUndefined()
    await container.configureAsync([
      { providesServices: [provideService(service, { ok: true })] },
    ])
    expect(live.value?.ok).toBe(true)
    await container.configureAsync([])
    expect(live.value).toBeUndefined()
  })
})
