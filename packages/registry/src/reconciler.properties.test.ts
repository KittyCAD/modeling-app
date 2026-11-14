import { factory } from './algebra'
import { computed, signal } from '@preact/signals-core'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { contribute, Facet, provide, type Factory, service } from './algebra'
import { Registry } from './nextRegistry'

const runs = { numRuns: 150 }

it('preserves owners and surviving children through generated replacement histories', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 8 }), {
        maxLength: 8,
      }),
      async (history) => {
        const reconciler = new Registry()
        const facet = new Facet(
          'children',
          (values: readonly { id: number }[]) => values
        )
        const observed = reconciler.observe(facet)
        const acquisitions = Array<number>(6).fill(0)
        const disposals = Array<number>(6).fill(0)
        const released: (number | string)[] = []
        let owners = 0
        let dependencies = 0
        const dependency: Factory = factory({
          create: () => {
            dependencies++
            return {
              items: [],
              dispose: async () => {
                await Promise.resolve()
                released.push('dependency')
              },
            }
          },
        })
        const children: Factory[] = acquisitions.map((_, id) =>
          factory({
            create: () => {
              acquisitions[id]++
              const resource = { id }
              return {
                items: [contribute(facet, () => resource)],
                dispose: async () => {
                  await Promise.resolve()
                  disposals[id]++
                  released.push(id)
                },
              }
            },
          })
        )
        const owner: Factory = factory({
          dependencies: { dependency0: dependency },
          create: () => {
            owners++
            return {
              items: [],
              dispose: async () => {
                await Promise.resolve()
                released.push('owner')
              },
            }
          },
        })
        const mounting = reconciler.configure([owner])
        expect(owners).toBe(1)
        await mounting
        let previous: number[] = []
        const expectedAcquisitions = Array<number>(6).fill(0)
        const expectedDisposals = Array<number>(6).fill(0)
        const expectedReleases: (number | string)[] = []
        for (const selection of history) {
          const selected = [...new Set(selection)]
          const previousValues = new Map(
            observed.value.map((value) => [value.id, value])
          )
          for (const id of selected)
            if (!previous.includes(id)) expectedAcquisitions[id]++
          for (const id of [...previous].reverse()) {
            if (!selected.includes(id)) {
              expectedDisposals[id]++
              expectedReleases.push(id)
            }
          }
          // Grouping and duplicate occurrences must not change lifetime identity.
          await reconciler.replace(owner, [selection.map((id) => children[id])])
          expect(observed.value.map((value) => value.id)).toEqual(selected)
          for (const value of observed.value) {
            if (previousValues.has(value.id))
              expect(value).toBe(previousValues.get(value.id))
          }
          expect(acquisitions).toEqual(expectedAcquisitions)
          expect(disposals).toEqual(expectedDisposals)
          expect(released).toEqual(expectedReleases)
          expect(owners).toBe(1)
          expect(dependencies).toBe(1)
          previous = selected
        }
        await reconciler.configure([])
        expect(released).toEqual([
          ...expectedReleases,
          ...previous.toReversed(),
          'owner',
          'dependency',
        ])
      }
    ),
    runs
  )
})

it('rolls back failed acquisition without publishing bindings or releasing old owners', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.integer(), { maxLength: 8 }),
      fc.integer(),
      async (payloads, initial) => {
        const reconciler = new Registry()
        const facet = new Facet('values', (values: readonly number[]) => values)
        const capability = service<{ readonly value: number }>('current')
        const value = signal(initial)
        const acquired: number[] = []
        const released: number[] = []
        let owners = 0
        let oldDisposals = 0
        let ownerDisposals = 0
        const original = { value: initial }
        const old: Factory = factory({
          create: () => ({
            items: [
              contribute(facet, () => value.value),
              provide(capability, original),
            ],
            dispose: () => {
              oldDisposals++
            },
          }),
        })
        const owner: Factory = factory({
          create: () => {
            owners++
            return {
              items: [old],
              dispose: () => {
                ownerDisposals++
              },
            }
          },
        })
        await reconciler.configure([owner])
        const originalSurface = reconciler.required(capability)
        const observation = reconciler.observe(facet)
        const before = observation.value
        const published: unknown[] = []
        const unsubscribe = observation.subscribe((next) =>
          published.push(next)
        )
        const failure = new Error('acquisition failed')
        let attempted = 0
        let next: Factory = factory({
          create: () => {
            attempted++
            throw failure
          },
        })
        for (let index = payloads.length - 1; index >= 0; index--) {
          const child = next
          const id = index
          next = factory({
            create: () => {
              acquired.push(id)
              return {
                items: [contribute(facet, () => payloads[id]), child],
                dispose: async () => {
                  await Promise.resolve()
                  released.push(id)
                },
              }
            },
          })
        }

        await expect(reconciler.replace(owner, [next])).rejects.toBe(failure)
        expect(attempted).toBe(1)
        expect(acquired).toEqual(payloads.map((_, index) => index))
        expect(released).toEqual(payloads.map((_, index) => index).reverse())
        expect(observation.value).toBe(before)
        expect(published).toEqual([before])
        expect(owners).toBe(1)
        expect(oldDisposals).toBe(0)
        expect(ownerDisposals).toBe(0)
        expect(reconciler.required(capability)).toBe(originalSurface)
        // The old graph remains reactive and can participate in another transaction.
        value.value = initial === 0 ? 1 : 0
        expect(observation.value).toEqual([value.value])
        await reconciler.replace(owner, [old])
        expect(oldDisposals).toBe(0)
        unsubscribe()
        await reconciler.configure([])
        expect(oldDisposals).toBe(1)
        expect(ownerDisposals).toBe(1)
        expect(released).toHaveLength(payloads.length)
      }
    ),
    runs
  )
})

it('commits mixed Facet types together, isolates registries, and discards failed drafts', async () => {
  const changes = fc.record({
    numbers: fc.array(fc.integer(), { maxLength: 5 }),
    strings: fc.array(fc.string(), { maxLength: 5 }),
    fails: fc.boolean(),
  })
  await fc.assert(
    fc.asyncProperty(
      fc.array(changes, { minLength: 1, maxLength: 8 }),
      async (history) => {
        // Equal diagnostic names must not merge different tokens or input types.
        const numbers = new Facet(
          'values',
          (values: readonly number[]) => values
        )
        const strings = new Facet(
          'values',
          (values: readonly string[]) => values
        )
        const first = new Registry()
        const second = new Registry()
        await second.configure([
          contribute(numbers, () => 42),
          contribute(strings, () => 'other registry'),
        ])
        const numberView = first.observe(numbers)
        const stringView = first.observe(strings)
        const combined = computed(() => ({
          numbers: numberView.value,
          strings: stringView.value,
        }))
        const published: unknown[] = []
        const unsubscribe = combined.subscribe((value) => published.push(value))
        let expected: {
          numbers: readonly number[]
          strings: readonly string[]
        } = { numbers: [], strings: [] }
        const failure = new Error('discard this draft')
        const broken: Factory = factory({
          create: () => {
            throw failure
          },
        })
        for (const change of history) {
          const before = combined.value
          const publicationCount = published.length
          const items = [
            ...change.numbers.map((value) => contribute(numbers, () => value)),
            ...change.strings.map((value) => contribute(strings, () => value)),
          ]
          if (change.fails) {
            await expect(first.configure([...items, broken])).rejects.toBe(
              failure
            )
            expect(combined.value).toBe(before)
            expect(published).toHaveLength(publicationCount)
          } else {
            await first.configure(items)
            expected = { numbers: change.numbers, strings: change.strings }
            // No subscriber may see numbers from one graph and strings from another.
            for (const value of published.slice(publicationCount))
              expect(value).toEqual(expected)
          }
          expect(combined.value).toEqual(expected)
          expect(second.observe(numbers).value).toEqual([42])
          expect(second.observe(strings).value).toEqual(['other registry'])
        }
        await first.configure([])
        expect(combined.value).toEqual({ numbers: [], strings: [] })
        expect(second.observe(numbers).value).toEqual([42])
        expect(second.observe(strings).value).toEqual(['other registry'])
        unsubscribe()
        await second.configure([])
      }
    ),
    runs
  )
})
