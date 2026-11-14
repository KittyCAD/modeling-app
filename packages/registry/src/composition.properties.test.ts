import { computed, signal } from '@preact/signals-core'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { contribute, type Extension, factory, Facet } from './algebra'
import { plan } from './planner'
import { Registry } from './nextRegistry'

const runs = { numRuns: 150 }

it('regrouping and empty groups preserve selected items, values, and mounted lifetimes', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.integer(), { maxLength: 8 }),
      fc.array(fc.nat({ max: 8 }), { minLength: 1, maxLength: 8 }),
      async (values, splits) => {
        const registry = new Registry()
        const facet = new Facet('values', (inputs: readonly number[]) => inputs)
        const created: number[] = []
        const disposed: number[] = []
        const items = values.map((value, index) =>
          factory({
            create() {
              created.push(index)
              return {
                items: [contribute(facet, () => value)],
                dispose: () => {
                  disposed.push(index)
                },
              }
            },
          })
        )
        try {
          await registry.configure(items)
          for (const split of splits) {
            const grouped: readonly Extension[] = [
              [],
              [items.slice(0, split), []],
              [[], items.slice(split)],
              [],
            ]
            expect(plan(grouped).map(({ item }) => item)).toEqual(items)
            await registry.configure(grouped)
            expect(registry.get(facet)).toEqual(values)
            expect(created).toEqual(values.map((_, index) => index))
            expect(disposed).toEqual([])
          }
        } finally {
          await registry.dispose()
        }
        expect(disposed).toEqual(values.map((_, index) => index).reverse())
      }
    ),
    runs
  )
})

it('projected observations preserve values through updates, replacement, and failed setup', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.integer({ min: -100, max: 100 }), {
        minLength: 2,
        maxLength: 8,
      }),
      fc.integer({ min: -10, max: 10 }),
      async (values, offset) => {
        const registry = new Registry()
        const facet = new Facet('total', (inputs: readonly number[]) =>
          inputs.reduce((sum, value) => sum + value, 0)
        )
        const observed = registry.observe(facet)
        const identity = computed(() => observed.value)
        const shifted = computed(() => observed.value + offset)
        const nested = computed(() => shifted.value * 2)
        const direct = computed(() => (observed.value + offset) * 2)
        const check = (expected: number) => {
          expect(identity.value).toBe(expected)
          expect(nested.value).toBe((expected + offset) * 2)
          expect(direct.value).toBe(nested.value)
        }
        const failure = new Error('setup failed')
        const broken = factory({
          create: () => {
            throw failure
          },
        })
        let previous = signal(0)
        try {
          check(0)
          for (const value of values) {
            const current = signal(value)
            const binding = contribute(facet, () => current.value)
            await registry.configure([binding])
            previous.value++
            check(value)
            current.value = value + 1
            check(value + 1)
            await expect(
              registry.configure([
                contribute(facet, () => value + 1000),
                broken,
              ])
            ).rejects.toBe(failure)
            check(value + 1)
            current.value = value + 2
            check(value + 2)
            previous = current
          }
        } finally {
          await registry.dispose()
        }
        check(0)
      }
    ),
    runs
  )
})
