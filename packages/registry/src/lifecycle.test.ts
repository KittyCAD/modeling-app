import { computed, effect } from '@preact/signals-core'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { contribute, factory, Facet, slot } from './algebra'
import { Registry } from './nextRegistry'

it('starts observers against complete publications and preserves them through replacement', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.integer(), { minLength: 1, maxLength: 8 }),
      async (values) => {
        const registry = new Registry()
        const first = new Facet(
          'first',
          (inputs: readonly number[]) => inputs[0]
        )
        const second = new Facet(
          'second',
          (inputs: readonly number[]) => inputs[0]
        )
        const firstValue = registry.observe(first)
        const secondValue = registry.observe(second)
        const bindings = (value: number) => [
          contribute(first, () => value),
          contribute(second, () => value),
        ]
        const children = slot(bindings(values[0]))
        const snapshots: (readonly [number | undefined, number | undefined])[] =
          []
        let starts = 0
        let stops = 0
        const owner = factory({
          create: () => {
            const pair = computed(
              () => [firstValue.value, secondValue.value] as const
            )
            return {
              items: [children],
              start: () => {
                starts++
                const stop = effect(() => {
                  snapshots.push(pair.value)
                })
                return () => {
                  stops++
                  stop()
                }
              },
            }
          },
        })
        try {
          await registry.configure([owner])
          expect(snapshots).toEqual([[values[0], values[0]]])
          for (const value of values) {
            await registry.configure([owner])
            await registry.replace(children, bindings(value))
            expect(snapshots.at(-1)).toEqual([value, value])
          }
          expect(snapshots.every(([a, b]) => a === b)).toBe(true)
          expect(starts).toBe(1)
          expect(stops).toBe(0)
        } finally {
          await registry.dispose()
        }
        expect(stops).toBe(1)
      }
    ),
    { numRuns: 100 }
  )
})

it('never starts rolled-back instances and releases all their acquired resources', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 12 }), async (count) => {
      const registry = new Registry()
      const values = new Facet('values', (inputs: readonly number[]) => inputs)
      const published = contribute(values, () => -1)
      await registry.configure([published])
      const events: string[] = []
      const instances = Array.from({ length: count }, (_, id) =>
        factory({
          create: () => ({
            items: [contribute(values, () => id)],
            start: () => {
              events.push(`start ${id}`)
              return () => {
                events.push(`stop ${id}`)
              }
            },
            dispose: () => {
              events.push(`dispose ${id}`)
            },
          }),
        })
      )
      const failure = new Error('acquisition failed')
      const broken = factory({
        create: () => {
          throw failure
        },
      })
      await expect(registry.configure([...instances, broken])).rejects.toBe(
        failure
      )
      expect(events).toEqual(
        Array.from({ length: count }, (_, i) => `dispose ${count - i - 1}`)
      )
      expect(registry.get(values)).toEqual([-1])
      await registry.dispose()
    }),
    { numRuns: 50 }
  )
})

it('awaits stopped children before disposing their owner and starting replacements', async () => {
  const registry = new Registry()
  const events: string[] = []
  let finish: () => void = () => {
    throw new Error('Cleanup has not started')
  }
  const child = factory({
    create: () => ({
      start: () => () =>
        new Promise<void>((resolve) => {
          events.push('stopping child')
          finish = () => {
            events.push('stopped child')
            resolve()
          }
        }),
      dispose: () => {
        events.push('disposed child')
      },
    }),
  })
  const owner = factory({
    create: () => ({
      items: [child],
      start: () => () => {
        events.push('stopped owner')
      },
      dispose: () => {
        events.push('disposed owner')
      },
    }),
  })
  const replacement = factory({
    create: () => ({
      start: () => {
        events.push('started replacement')
      },
    }),
  })
  await registry.configure([owner])
  const completion = registry.configure([replacement])
  expect(events).toEqual(['stopping child'])
  await expect(registry.configure([])).rejects.toThrow('already in progress')
  finish()
  await completion
  expect(events).toEqual([
    'stopping child',
    'stopped child',
    'disposed child',
    'stopped owner',
    'disposed owner',
    'started replacement',
  ])
  await registry.dispose()
})

it('preserves publication, cleanup, and startup failures while completing the committed lifecycle', async () => {
  const registry = new Registry()
  const value = new Facet('value', (inputs: readonly number[]) => inputs[0])
  const publication = new Error('publication failed')
  const stopFailure = new Error('stop failed')
  const disposeFailure = new Error('dispose failed')
  const startFailure = new Error('start failed')
  const events: string[] = []
  const old = factory({
    create: () => ({
      items: [contribute(value, () => 1)],
      start: () => () => {
        events.push('stop')
        throw stopFailure
      },
      dispose: () => {
        events.push('dispose')
        throw disposeFailure
      },
    }),
  })
  await registry.configure([old])
  let publishing = false
  const unsubscribe = registry.observe(value).subscribe(() => {
    if (publishing) throw publication
  })
  publishing = true
  const broken = factory({
    create: () => ({
      start: () => {
        events.push('broken start')
        throw startFailure
      },
      dispose: () => {
        events.push('broken dispose')
      },
    }),
  })
  const healthy = factory({
    create: () => ({
      items: [contribute(value, () => 2)],
      start: () => {
        events.push('healthy start')
        return () => {
          events.push('healthy stop')
        }
      },
    }),
  })
  await expect(registry.configure([broken, healthy])).rejects.toMatchObject({
    errors: [
      { errors: [publication, { errors: [stopFailure, disposeFailure] }] },
      startFailure,
    ],
  })
  expect(events).toEqual(['stop', 'dispose', 'broken start', 'healthy start'])
  expect(registry.get(value)).toBe(2)
  unsubscribe()
  await registry.configure([broken, healthy])
  expect(events).toEqual(['stop', 'dispose', 'broken start', 'healthy start'])
  await registry.dispose()
  expect(events.slice(-2)).toEqual(['healthy stop', 'broken dispose'])
})

it('starts shared dependencies once before their consumers and binds lifecycle methods to their instance', async () => {
  const registry = new Registry()
  const events: string[] = []
  const dependency = factory({
    create: () => ({
      exports: { ready: false },
      start() {
        this.exports.ready = true
        events.push('dependency')
        return () => {
          events.push('dependency stopped')
        }
      },
    }),
  })
  const consumer = (id: string) =>
    factory({
      dependencies: { dependency },
      create: ({ dependency }) => ({
        start: () => {
          expect(dependency.ready).toBe(true)
          events.push(id)
          return () => {
            events.push(`${id} stopped`)
          }
        },
      }),
    })
  await registry.configure([consumer('first'), consumer('second')])
  expect(events).toEqual(['dependency', 'first', 'second'])
  await registry.dispose()
  expect(events.slice(3)).toEqual([
    'second stopped',
    'first stopped',
    'dependency stopped',
  ])
})
