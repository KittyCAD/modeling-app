import { extension } from './algebra'
import { signal } from '@preact/signals-core'
import { expect, it } from 'vitest'
import {
  contribute,
  Facet,
  provide,
  type Extension,
  service,
  slot,
} from './algebra'
import { Registry } from './next'

it('ignores dependencies of a discarded keyed definition', async () => {
  const registry = new Registry()
  const first: Extension = extension({
    key: 'owner',
    create: () => ({ items: [] }),
  })
  const discarded: Extension = extension({
    key: 'owner',
    dependencies: {
      dependency0: extension({
        create: () => {
          throw new Error('Discarded dependency must not acquire')
        },
      }),
    },
    create: () => {
      throw new Error('Discarded owner must not acquire')
    },
  })
  await registry.configure([first, discarded])
  expect(registry.inspect().extensions).toBe(1)
  await registry.dispose()
})

it('shows only selected contributions and updates inspection after replacement', async () => {
  const registry = new Registry()
  const facet = new Facet('values', (values: readonly number[]) => values)
  let reads = 0
  const owner = slot(
    [
      contribute(
        facet,
        () => {
          reads++
          return 1
        },
        { key: 'same', precedence: 'low' }
      ),
      contribute(
        facet,
        () => {
          reads++
          return 2
        },
        { key: 'same', precedence: 'high' }
      ),
      contribute(facet, () => {
        reads++
        return 3
      }),
    ],
    'panels'
  )
  await registry.configure([owner])
  const debug = registry.debug(facet)
  expect(
    debug.value.map(({ key, precedence }) => ({ key, precedence }))
  ).toEqual([
    { key: 'same', precedence: 'high' },
    { key: undefined, precedence: 'default' },
  ])
  expect(
    debug.value.every(
      ({ origin }) => origin.id === 'panels' && origin.path.length > 0
    )
  ).toBe(true)
  expect(reads).toBe(0)
  expect(registry.inspect()).toMatchObject({ extensions: 1, facets: 1 })
  expect(registry.get(facet)).toEqual([2, 3])
  await registry.replace(owner, [])
  expect(debug.value).toEqual([])
  expect(registry.inspect()).toMatchObject({
    extensions: 1,
    bindings: 0,
    facets: 0,
  })
  await registry.dispose()
  expect(registry.inspect().extensions).toBe(0)
})

it('keeps disposal terminal and idempotent even when a finalizer fails', async () => {
  const registry = new Registry()
  const facet = new Facet('values', (values: readonly number[]) => values)
  const cleanup = new Error('cleanup failed')
  let disposals = 0
  const owner: Extension = extension({
    create: () => ({
      items: [contribute(facet, () => 1)],
      dispose: () => {
        disposals++
        throw cleanup
      },
    }),
  })
  await registry.configure([owner])
  const closing = registry.dispose()
  expect(registry.dispose()).toBe(closing)
  await expect(closing).rejects.toMatchObject({ errors: [cleanup] })
  await expect(registry[Symbol.asyncDispose]()).rejects.toMatchObject({
    errors: [cleanup],
  })
  expect(disposals).toBe(1)
  expect(registry.get(facet)).toEqual([])
  await expect(registry.configure([owner])).rejects.toThrow(/disposed/i)
  await expect(registry.replace(owner, [])).rejects.toThrow(/disposed/i)
})

it('blocks capability calls and registry mutations during Facet combination', async () => {
  const registry = new Registry()
  const count = signal(0)
  const capability = service<{ increment(): void }>('counter')
  const owner = slot([
    provide(capability, {
      increment: () => {
        count.value++
      },
    }),
  ])
  await registry.configure([owner])
  const callsCapability = new Facet('invalid-capability-use', () => {
    registry.required(capability).increment()
    return 0
  })
  expect(() => registry.get(callsCapability)).toThrow()
  expect(count.value).toBe(0)
  const mutatesRegistry = new Facet('invalid-registry-use', () => {
    void registry.replace(owner, [])
    return 0
  })
  expect(() => registry.get(mutatesRegistry)).toThrow()
  registry.required(capability).increment()
  expect(count.value).toBe(1)
  await registry.dispose()
})

it('preserves protected capability identity across equivalent reconfiguration', async () => {
  const registry = new Registry()
  const token = service<{ readonly value: number; read(): number }>('value')
  const implementation = Object.freeze({ value: 7, read: () => 7 })
  await registry.configure([provide(token, implementation)])
  const before = registry.required(token)
  await registry.configure([provide(token, implementation)])
  expect(registry.required(token)).toBe(before)
  expect(registry.required(token).read()).toBe(7)
  await registry.dispose()
})

it('keeps the declared keyed definition when acquisition discovers a conflicting definition', async () => {
  const registry = new Registry()
  const facet = new Facet('values', (values: readonly string[]) => values)
  let declaredAcquisitions = 0
  let legitimateDependencies = 0
  let discardedAcquisitions = 0
  let discardedDependencies = 0
  const declared: Extension = extension({
    key: 'shared',
    dependencies: {
      dependency0: extension({
        create: () => {
          legitimateDependencies++
          return { items: [contribute(facet, () => 'dependency')] }
        },
      }),
    },
    create: () => {
      declaredAcquisitions++
      return { items: [contribute(facet, () => 'declared')] }
    },
  })
  const discovered: Extension = extension({
    key: 'shared',
    dependencies: {
      dependency0: extension({
        create: () => {
          discardedDependencies++
          throw new Error(
            'A discarded definition must not activate its dependencies'
          )
        },
      }),
    },
    create: () => {
      discardedAcquisitions++
      throw new Error(
        'A discovered duplicate must not replace the declared definition'
      )
    },
  })
  const outer: Extension = extension({
    create: () => ({ items: [discovered] }),
  })

  await registry.configure([outer, declared])
  expect(registry.get(facet)).toEqual(['dependency', 'declared'])
  expect(declaredAcquisitions).toBe(1)
  expect(legitimateDependencies).toBe(1)
  expect(discardedAcquisitions).toBe(0)
  expect(discardedDependencies).toBe(0)
  await registry.dispose()
})

it('acquires a declared definition once when an earlier owner returns that exact object', async () => {
  const registry = new Registry()
  const facet = new Facet('values', (values: readonly string[]) => values)
  let acquisitions = 0
  let dependencies = 0
  const declared: Extension = extension({
    key: 'shared',
    dependencies: {
      dependency0: extension({
        create: () => {
          dependencies++
          return { items: [] }
        },
      }),
    },
    create: () => {
      acquisitions++
      return { items: [contribute(facet, () => 'declared')] }
    },
  })
  const outer: Extension = extension({ create: () => ({ items: [declared] }) })

  await registry.configure([outer, declared])
  expect(registry.get(facet)).toEqual(['declared'])
  expect(acquisitions).toBe(1)
  expect(dependencies).toBe(1)
  await registry.dispose()
})
