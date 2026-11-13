import { computed, signal } from '@preact/signals-core'
import { assertType, expect, it } from 'vitest'
import { createScope, optional, required, type ScopeHost } from './algebra'
import {
  type CapabilityOf,
  type Contract,
  contract,
  contribute,
  extension,
  Facet,
  type InputOf,
  type OutputOf,
  provide,
  type Service,
  ServiceResolutionError,
  type Signal,
  type Source,
  type Extension,
  service,
  slot,
} from './next'
import { Registry } from './nextRegistry'

it('keeps capability and facet types through a shared contract', () => {
  const contract = {
    count: new Facet('count', (values: readonly number[]) =>
      values.reduce((sum, value) => sum + value, 0)
    ),
    save: service<{ save(): void }>('save'),
  } satisfies Contract

  assertType<number>(contract.count.combine([1, 2]))
  // @ts-expect-error A contract must preserve the facet's input type.
  assertType<Parameters<typeof contract.count.combine>[0]>(['wrong'])
  // @ts-expect-error Distinct capability shapes cannot substitute for one another.
  assertType<Service<{ load(): string }>>(contract.save)
  // @ts-expect-error Contracts contain tokens, not arbitrary configuration.
  assertType<Contract>({ retries: 3 })

  // @ts-expect-error Provider types are determined by the service token.
  provide(contract.save, { load: () => 'wrong' })
  // @ts-expect-error Contribution sources cannot widen a facet's input type.
  contribute(contract.count, () => 'wrong')

  expect(contract.count.combine([])).toBe(0)
  expect(contract.count.combine([2, 3])).toBe(5)
})

it('tracks explicit reads without confusing ordinary values with signals', () => {
  const number = signal(2)
  const literal: Source<{ value: number }> = () => ({ value: 10 })
  const live: Source<number> = () => number.value
  const total = computed(() => literal().value + live())

  expect(total.value).toBe(12)
  number.value = 7
  expect(total.value).toBe(17)
})

it('allows optional absence but reports required absence', () => {
  const token = service<{ save(): void }>('document')
  const resolution = token.combine([])

  expect(resolution).toEqual({ kind: 'missing' })
  expect(optional(token, resolution)).toBeUndefined()
  expect(() => required(token, resolution)).toThrow(
    'document: expected one provider, received 0'
  )
})

it('preserves the sole provider capability without invoking its methods', () => {
  const token = service<{ save(): void }>('document')
  const capability = {
    save: () => {
      throw new Error('resolution must not invoke capabilities')
    },
  }
  const resolution = token.combine([
    { id: 'document.provider', path: 'root/document', value: capability },
  ])

  expect(required(token, resolution)).toBe(capability)
  expect(optional(token, resolution)).toBe(capability)
})

it.each([
  ['filesystem', 'cloud'],
  ['cloud', 'filesystem'],
  ['filesystem', 'cloud', 'scratch'],
])('rejects conflicting providers and reports every source: %j', (...ids) => {
  const token = service<{ save(): void }>('document')
  const providers = ids.map((id) => ({
    id,
    path: `root/${id}`,
    value: { save: () => {} },
  }))
  const resolution = token.combine(providers)

  expect(resolution).toEqual({ kind: 'conflict', providers })
  for (const read of [required, optional]) {
    let failure: unknown
    try {
      read(token, resolution)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ServiceResolutionError)
    if (!(failure instanceof ServiceResolutionError)) throw failure
    expect(failure.serviceName).toBe('document')
    expect(failure.providers).toEqual(providers)
    for (const id of ids) {
      expect(failure.message).toContain(JSON.stringify(id))
      expect(failure.message).toContain(JSON.stringify(`root/${id}`))
    }
  }
})

it('derives adapter types from tokens and rejects callable extensions', () => {
  const _count = new Facet(
    'count',
    (values: readonly number[]) => `${values.length}`
  )
  const _save = service<{ save(): void }>('save')
  assertType<InputOf<typeof _count>>(42)
  assertType<OutputOf<typeof _count>>('2')
  assertType<CapabilityOf<typeof _save>>({ save: () => {} })
  // @ts-expect-error Adapter input types must match their facet.
  assertType<InputOf<typeof _count>>('wrong')
  // @ts-expect-error Adapter output types must match their facet.
  assertType<OutputOf<typeof _count>>(42)
  // @ts-expect-error Capability types retain required methods.
  assertType<CapabilityOf<typeof _save>>({ load: () => {} })
  // @ts-expect-error Extensions are objects with a create operation.
  assertType<Extension>(() => ({ items: [] }))
})

it('injects each named dependency before the consumer constructor runs', async () => {
  const registry = new Registry()
  const results = new Facet('results', (values: readonly number[]) => values)
  const first = extension({ create: () => ({ exports: { read: () => 1 } }) })
  const second = extension({ create: () => ({ exports: { read: () => 2 } }) })
  const consumer = extension({
    dependencies: { first, second },
    create({ first, second }) {
      const result = first.read() * 10 + second.read()
      return { items: [contribute(results, () => result)] }
    },
  })
  try {
    await registry.configure([consumer])
    expect(registry.get(results)).toEqual([12])
  } finally {
    await registry.dispose()
  }
})

it('snapshots contracts and slot content without freezing author-owned containers', () => {
  const token = service<{ save(): void }>('save')
  const authorContract = { save: token }
  const vocabulary = contract(authorContract)
  authorContract.save = service('replacement')
  expect(vocabulary.save).toBe(token)
  expect(Object.isFrozen(vocabulary)).toBe(true)
  assertType<() => void>(() => {
    // @ts-expect-error Contract snapshots expose readonly properties.
    vocabulary.save = token
  })

  const binding = provide(token, { save: () => {} })
  const items = [binding]
  const subtree = slot(items)
  const scope = createScope(
    { id: 'slot', path: 'root/slot' },
    observationHost([])
  )
  items.length = 0
  const instance = subtree.create({}, scope)
  expect(instance.items).toEqual([binding])
  expect(Object.isFrozen(instance.items)).toBe(true)
  expect(instance.dispose).toBeUndefined()
})

/** A typed observation table fixture, not a graph interpreter. */
function observationHost(
  entries: readonly (readonly [object, Signal<unknown>])[]
): ScopeHost {
  const observations = new Map(entries)
  return {
    observe: <I, O>(facet: Facet<I, O>): Signal<O> => {
      const observation = observations.get(facet)
      if (!observation) throw new Error(`Unexpected observation: ${facet.name}`)
      // Each fixture entry pairs a token with its output signal.
      return observation as Signal<O>
    },
    replace: async () => {},
  }
}
