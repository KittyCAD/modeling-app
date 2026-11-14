import { factory } from './algebra'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { contribute, Facet, type Precedence, type Factory } from './algebra'
import { Registry } from './next'

const priorities = ['highest', 'high', 'default', 'low', 'lowest'] as const
const runs = { numRuns: 150 }

it('orders contributions stably and deduplicates keys within each Facet after precedence', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          facet: fc.integer({ min: 0, max: 1 }),
          precedence: fc.constantFrom<Precedence>(...priorities),
          key: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }),
          value: fc.integer(),
        }),
        { maxLength: 30 }
      ),
      async (entries) => {
        const registry = new Registry()
        const facets = [
          new Facet('first', (values: readonly number[]) => values),
          new Facet('second', (values: readonly number[]) => values),
        ]
        await registry.configure(
          entries.map((entry) =>
            contribute(facets[entry.facet], () => entry.value, {
              key: entry.key === undefined ? undefined : `key-${entry.key}`,
              precedence: entry.precedence,
            })
          )
        )
        for (const [facetIndex, facet] of facets.entries()) {
          const candidates = entries
            .map((entry, index) => ({ ...entry, index }))
            .filter((entry) => entry.facet === facetIndex)
          // Select each key's best declaration independently of the runtime's
          // collect/sort/deduplicate implementation.
          const expected = candidates
            .filter(
              (entry) =>
                entry.key === undefined ||
                !candidates.some(
                  (other) =>
                    other.key === entry.key &&
                    (priorities.indexOf(other.precedence) <
                      priorities.indexOf(entry.precedence) ||
                      (other.precedence === entry.precedence &&
                        other.index < entry.index))
                )
            )
            .sort(
              (left, right) =>
                priorities.indexOf(left.precedence) -
                  priorities.indexOf(right.precedence) ||
                left.index - right.index
            )
            .map((entry) => entry.value)
          expect(registry.get(facet)).toEqual(expected)
          expect(registry.debug(facet).value).toHaveLength(expected.length)
        }
        await registry.dispose()
      }
    ),
    runs
  )
})

it('retains keyed resources across rebuilt definitions and reacquires only after removal', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.array(fc.integer({ min: 0, max: 4 }), { maxLength: 7 }), {
        maxLength: 10,
      }),
      async (history) => {
        const registry = new Registry()
        const facet = new Facet(
          'resources',
          (values: readonly { id: number; generation: number }[]) => values
        )
        const acquired = Array<number>(5).fill(0)
        const released = Array<number>(5).fill(0)
        const expectedAcquired = Array<number>(5).fill(0)
        const expectedReleased = Array<number>(5).fill(0)
        let previous = new Set<number>()
        let previousResources = new Map<
          number,
          { id: number; generation: number }
        >()
        for (const selection of history) {
          const selected = new Set(selection)
          for (const id of selected)
            if (!previous.has(id)) expectedAcquired[id]++
          for (const id of previous)
            if (!selected.has(id)) expectedReleased[id]++
          const definitions: Factory[] = selection.map((id) =>
            factory({
              key: `resource-${id}`,
              create: () => {
                const resource = { id, generation: ++acquired[id] }
                return {
                  items: [contribute(facet, () => resource)],
                  dispose: async () => {
                    await Promise.resolve()
                    released[id]++
                  },
                }
              },
            })
          )
          await registry.configure(definitions)
          const resources = registry.get(facet)
          expect(resources.map(({ id }) => id)).toEqual([...selected])
          for (const resource of resources) {
            if (previous.has(resource.id))
              expect(resource).toBe(previousResources.get(resource.id))
            expect(resource.generation).toBe(expectedAcquired[resource.id])
          }
          expect(acquired).toEqual(expectedAcquired)
          expect(released).toEqual(expectedReleased)
          previous = selected
          previousResources = new Map(
            resources.map((resource) => [resource.id, resource])
          )
        }
        await registry.dispose()
        expect(released).toEqual(acquired)
      }
    ),
    runs
  )
})
