import { signal } from '@preact/signals-core'
import {
  contribute,
  extension,
  Facet,
  provide,
  Registry,
  ServiceResolutionError,
  service,
} from 'plankton'
import { expect, expectTypeOf, it } from 'vitest'
import { inputs, observe, observeService } from '@src/registry/inputs'

it('injects live contract observations while their providers appear and disappear', async () => {
  const registry = new Registry()
  const counter = service<{ count: number }>('counter')
  const contract = inputs({ counter: observeService(counter) })
  let optional = (): number | undefined => undefined
  let required = () => 0
  const consumer = extension({
    dependencies: { contract },
    create({ contract: { counter } }) {
      expectTypeOf(counter.required).returns.toEqualTypeOf<{ count: number }>()
      optional = () => counter.current.value?.count
      required = () => counter.required().count
      return {}
    },
  })
  try {
    await registry.configure([consumer])
    expect(optional()).toBeUndefined()
    expect(required).toThrow(ServiceResolutionError)
    const provider = provide(counter, { count: 7 })
    await registry.configure([consumer, provider])
    expect(optional()).toBe(7)
    expect(required()).toBe(7)
    await registry.configure([consumer])
    expect(optional()).toBeUndefined()
    expect(required).toThrow('expected one provider, received 0')
  } finally {
    await registry.dispose()
  }
})

it('keeps all conflicting provider identities in the injected service diagnostic', async () => {
  const registry = new Registry()
  const storage = service<{ path: string }>('storage')
  let read = () => ''
  const consumer = extension({
    dependencies: { storage: observeService(storage) },
    create({ storage }) {
      read = () => storage.required().path
      return {}
    },
  })
  const provider = (id: string) =>
    extension({
      key: id,
      create: () => ({ items: [provide(storage, { path: id })] }),
    })
  try {
    await registry.configure([consumer, provider('disk-a'), provider('disk-b')])
    let failure: unknown
    try {
      read()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ServiceResolutionError)
    if (!(failure instanceof ServiceResolutionError)) throw failure
    expect(failure.providers.map(({ id }) => id)).toEqual(['disk-a', 'disk-b'])
    expect(failure.providers.map(({ path }) => path)).toEqual([
      'root[1]',
      'root[2]',
    ])
  } finally {
    await registry.dispose()
  }
})

it('keeps injected Facet signals reactive after acquisition and reconfiguration', async () => {
  const registry = new Registry()
  const sum = new Facet('sum', (values: readonly number[]) =>
    values.reduce((a, b) => a + b, 0)
  )
  const value = signal(2)
  let read = () => -1
  const consumer = extension({
    dependencies: { sum: observe(sum) },
    create({ sum }) {
      expectTypeOf(() => sum.value).returns.toEqualTypeOf<number>()
      read = () => sum.value
      return {}
    },
  })
  const first = contribute(sum, () => value.value)
  try {
    await registry.configure([consumer, first])
    expect(read()).toBe(2)
    value.value = 5
    expect(read()).toBe(5)
    await registry.configure([consumer, first, contribute(sum, () => 3)])
    expect(read()).toBe(8)
  } finally {
    await registry.dispose()
  }
})

it('does not allow a live composition read to expose a partially acquired graph', async () => {
  const registry = new Registry()
  const value = new Facet(
    'value',
    (values: readonly number[]) => values[0] ?? 0
  )
  const consumer = extension({
    dependencies: { value: observe(value) },
    create: ({ value }) => ({ exports: value.value }),
  })
  try {
    await registry.configure([contribute(value, () => 9)])
    await expect(
      registry.configure([consumer, contribute(value, () => 10)])
    ).rejects.toThrow('Defer observations')
    expect(registry.get(value)).toBe(9)
  } finally {
    await registry.dispose()
  }
})

it.each(['required', 'optional'] as const)(
  'rejects a warmed %s service input during a later acquisition',
  async (mode) => {
    const registry = new Registry()
    const token = service<{ count: number }>('counter')
    const counter = observeService(token)
    let read = () => -1
    const retained = extension({
      dependencies: { counter },
      create({ counter }) {
        read = () =>
          mode === 'required'
            ? counter.required().count
            : counter.current.value!.count
        return {}
      },
    })
    const next = extension({
      dependencies: { counter },
      create({ counter }) {
        return {
          exports:
            mode === 'required'
              ? counter.required().count
              : counter.current.value!.count,
        }
      },
    })
    const original = provide(token, { count: 7 })
    try {
      await registry.configure([retained, original])
      expect(read()).toBe(7)
      await expect(
        registry.configure([retained, original, next])
      ).rejects.toThrow('Defer observations')
      expect(read()).toBe(7)
    } finally {
      await registry.dispose()
    }
  }
)
