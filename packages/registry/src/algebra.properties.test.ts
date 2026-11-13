import { extension } from './algebra'
import { computed, signal } from '@preact/signals-core'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import {
  type Binding,
  contribute,
  createScope,
  Facet,
  type Item,
  optional,
  provide,
  required,
  ServiceResolutionError,
  type Source,
  type Extension,
  service,
  slot,
} from './algebra'

type Sink = Parameters<Binding['install']>[0]

// A small ID domain deliberately exercises duplicates, escaping, and empty labels.
const label = fc.oneof(
  fc.string(),
  fc.constantFrom('', 'same', '"quoted"', 'line\nbreak', '💥')
)
const provider = fc.record({
  id: label,
  path: label,
  value: fc.record({ value: fc.integer() }),
})
const runs = { numRuns: 300 }

it.each([
  { kind: 'missing', minLength: 0, maxLength: 0 },
  { kind: 'ready', minLength: 1, maxLength: 1 },
  { kind: 'conflict', minLength: 2, maxLength: 20 },
] as const)(
  'resolves $kind by cardinality without mutating providers',
  (partition) => {
    fc.assert(
      fc.property(label, fc.array(provider, partition), (name, generated) => {
        const token = service<{ value: number }>(name)
        const providers = Object.freeze(
          generated.map((entry) =>
            Object.freeze({ ...entry, value: Object.freeze(entry.value) })
          )
        )
        const resolution = token.combine(providers)

        expect(resolution.kind).toBe(partition.kind)
        if (resolution.kind === 'ready') {
          expect(required(token, resolution)).toBe(providers[0].value)
          expect(optional(token, resolution)).toBe(providers[0].value)
        } else {
          for (const read of [required, optional]) {
            if (read === optional && partition.kind === 'missing') {
              expect(read(token, resolution)).toBeUndefined()
              continue
            }
            let failure: unknown
            try {
              read(token, resolution)
            } catch (error) {
              failure = error
            }
            expect(failure).toBeInstanceOf(ServiceResolutionError)
            if (!(failure instanceof ServiceResolutionError)) throw failure
            expect(failure.serviceName).toBe(name)
            expect(failure.providers).toHaveLength(providers.length)
            for (const [index, entry] of providers.entries()) {
              expect(failure.providers[index]).toBe(entry)
              expect(failure.message).toContain(JSON.stringify(entry.id))
              expect(failure.message).toContain(JSON.stringify(entry.path))
            }
          }
        }
      }),
      runs
    )
  }
)

it('keeps conflicts under every generated permutation, including duplicate IDs', () => {
  fc.assert(
    fc.property(
      fc.array(provider, { minLength: 2, maxLength: 20 }).chain((providers) =>
        fc.tuple(
          fc.constant(providers),
          fc.shuffledSubarray(providers, {
            minLength: providers.length,
            maxLength: providers.length,
          })
        )
      ),
      ([providers, reordered]) => {
        const token = service<{ value: number }>('capability')
        for (const inputs of [providers, reordered]) {
          const resolution = token.combine(inputs)
          expect(resolution.kind).toBe('conflict')
          if (resolution.kind !== 'conflict')
            throw new Error('Expected conflict')
          expect(resolution.providers).toHaveLength(inputs.length)
          for (const [index, input] of inputs.entries()) {
            expect(resolution.providers[index]).toBe(input)
          }
        }
      }
    ),
    runs
  )
})

it('registers a source lazily and preserves its live reads across updates', () => {
  fc.assert(
    fc.property(fc.array(fc.integer(), { minLength: 2 }), (updates) => {
      const token = new Facet('values', (values: readonly number[]) => values)
      const current = signal(updates[0])
      let reads = 0
      let registered: Source<unknown> | undefined
      const binding = contribute(token, () => {
        reads++
        return current.value
      })
      const sink: Sink = {
        origin: { id: 'example', path: 'root/example' },
        contribute: (facet, source) => {
          expect(facet).toBe(token)
          registered = source
        },
      }

      expect(reads).toBe(0)
      binding.install(sink)
      expect(reads).toBe(0)
      if (!registered) throw new Error('Source was not registered')
      const read = registered
      const observation = computed(() => read())
      for (const update of updates) {
        current.value = update
        expect(observation.value).toBe(update)
      }
    }),
    runs
  )
})

it('registers an identified service provider through the ordinary facet protocol', () => {
  fc.assert(
    fc.property(label, provider, (name, entry) => {
      const token = service<{ value: number }>(name)
      let registrations = 0
      provide(token, entry.value).install({
        origin: { id: entry.id, path: entry.path },
        contribute: (facet, source) => {
          registrations++
          expect(facet).toBe(token)
          const registered = source()
          expect(registered).toEqual(entry)
          if (
            !registered ||
            typeof registered !== 'object' ||
            !('value' in registered)
          ) {
            throw new Error('Provider value was not registered')
          }
          expect(registered.value).toBe(entry.value)
        },
      })
      expect(registrations).toBe(1)
    }),
    runs
  )
})

it('does not deduplicate repeated provider identities or implementation objects', () => {
  fc.assert(
    fc.property(provider, (entry) => {
      const token = service<{ value: number }>('capability')
      const resolution = token.combine([entry, entry])
      expect(resolution.kind).toBe('conflict')
      if (resolution.kind !== 'conflict') throw new Error('Expected conflict')
      expect(resolution.providers).toHaveLength(2)
      expect(resolution.providers[0]).toBe(entry)
      expect(resolution.providers[1]).toBe(entry)
      expect(() => optional(token, resolution)).toThrow(ServiceResolutionError)
    }),
    runs
  )
})

it('assigns provenance per installation and retains that ownership for later reads', () => {
  const origin = fc.record({ id: label, path: label })
  fc.assert(
    fc.property(origin, origin, fc.integer(), (first, second, number) => {
      const token = service<{ value: number }>('capability')
      const value = { value: number }
      const binding = provide(token, value)
      for (const location of [first, second]) {
        const installingOrigin = { ...location }
        let registered: Source<unknown> | undefined
        binding.install({
          origin: installingOrigin,
          contribute: (facet, source) => {
            expect(facet).toBe(token)
            registered = source
          },
        })
        installingOrigin.id = 'changed after installation'
        installingOrigin.path = 'changed after installation'
        if (!registered) throw new Error('Provider was not registered')
        expect(registered()).toEqual({ ...location, value })
      }
    }),
    runs
  )
})

it('acquires slot snapshots with child order, identity, and duplicates intact', () => {
  fc.assert(
    fc.property(fc.array(fc.nat({ max: 5 })), (indices) => {
      const facet = new Facet('values', (values: readonly number[]) => values)
      const pool = Array.from({ length: 6 }, (_, value) =>
        contribute(facet, () => value)
      )
      const expected = indices.map((index) => pool[index])
      const input: Item[] = [...expected]
      const subtree = slot(input)
      input.reverse()
      input.length = 0
      const scope = createScope(
        { id: 'slot', path: 'root/slot' },
        {
          observe: () => {
            throw new Error('Slot acquisition must not observe')
          },
          replace: async () => {
            throw new Error('Slot acquisition must not replace')
          },
        }
      )

      const instance = subtree.create({}, scope)
      expect(instance.dispose).toBeUndefined()
      expect(instance.items).toHaveLength(expected.length)
      for (const [index, child] of expected.entries()) {
        expect(instance.items![index]).toBe(child)
      }
      expect(Object.isFrozen(instance.items)).toBe(true)
    }),
    runs
  )
})

it('slot acquisition neither acquires nested extensions nor reads contributions', () => {
  fc.assert(
    fc.property(fc.array(fc.boolean()), (choices) => {
      let acquisitions = 0
      let reads = 0
      const facet = new Facet('values', (values: readonly number[]) => values)
      const binding = contribute(facet, () => {
        reads++
        return 1
      })
      const child: Extension = extension({
        create: () => {
          acquisitions++
          return { items: [binding] }
        },
      })
      const children = choices.map((nested) => (nested ? child : binding))
      const subtree = slot(children)
      const scope = createScope(
        { id: 'slot', path: 'root/slot' },
        {
          observe: () => {
            throw new Error('Unexpected observation')
          },
          replace: async () => {
            throw new Error('Unexpected replacement')
          },
        }
      )

      subtree.create({}, scope)
      expect(acquisitions).toBe(0)
      expect(reads).toBe(0)
    }),
    runs
  )
})

it('forwards replacement of any subtree without reacquiring or disposing its owner', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(fc.integer()), async (values) => {
      let acquisitions = 0
      let disposals = 0
      const facet = new Facet('values', (inputs: readonly number[]) => inputs)
      const initial = contribute(facet, () => -1)
      const owner: Extension = extension({
        create: () => {
          acquisitions++
          return {
            items: [initial],
            dispose: () => {
              disposals++
            },
          }
        },
      })
      const replacement = values.map((value) => contribute(facet, () => value))
      const requests: { subtree: Extension; items: readonly Item[] }[] = []
      const scope = createScope(
        { id: 'owner', path: 'root/owner' },
        {
          observe: () => {
            throw new Error('Unexpected observation')
          },
          replace: async (subtree, items) => {
            requests.push({ subtree, items })
          },
        }
      )
      const instance = owner.create({}, scope)

      await scope.replace(owner, replacement)
      expect(requests).toHaveLength(1)
      expect(requests[0].subtree).toBe(owner)
      expect(requests[0].items).toBe(replacement)
      expect(acquisitions).toBe(1)
      expect(disposals).toBe(0)
      expect(instance.items).toEqual([initial])
    }),
    runs
  )
})
