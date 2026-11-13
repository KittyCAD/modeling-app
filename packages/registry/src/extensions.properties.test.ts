import { effect } from '@preact/signals-core'
import fc from 'fast-check'
import { expect, expectTypeOf, it } from 'vitest'
import {
  contribute,
  type Extension,
  type Item,
  extension,
  Facet,
} from './algebra'
import { Registry } from './nextRegistry'

const runs = { numRuns: 120 }

interface Resource {
  readonly id: number
  readonly generation: number
  readonly dependencies: readonly Resource[]
  alive: boolean
}

// Roots describe reachability independently of acquisition and cleanup order.
function reachable(
  edges: readonly (readonly number[])[],
  roots: readonly number[]
) {
  const result = new Set(roots)
  for (const id of result) {
    for (const dependency of edges[id]) result.add(dependency)
  }
  return result
}

it('injects the declared extension exports with their inferred types', async () => {
  const registry = new Registry()
  const lengths = new Facet('lengths', (values: readonly number[]) => values)
  const files = extension({
    create: () => ({ exports: { read: (path: string) => path.length } }),
  })
  const editor = extension({
    dependencies: { storage: files },
    create({ storage }) {
      expectTypeOf(storage.read).toEqualTypeOf<(path: string) => number>()
      const length = storage.read('document.kcl')
      return {
        exports: { length },
        items: [contribute(lengths, () => length)],
      }
    },
  })
  try {
    await registry.configure([editor])
    expect(registry.get(lengths)).toEqual([12])
  } finally {
    await registry.dispose()
  }
})

it('shares dependency instances and keeps them alive until their last reachable consumer leaves', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.array(fc.nat({ max: 20 }), { maxLength: 4 }), {
        maxLength: 5,
      }),
      fc.array(fc.array(fc.nat({ max: 20 }), { maxLength: 6 }), {
        maxLength: 12,
      }),
      async (extraEdges, rootHistory) => {
        const registry = new Registry()
        const resources = new Facet(
          'resources',
          (values: readonly Resource[]) => values
        )
        // Every run includes a diamond; generated tails add transitive sharing and repeated edges.
        const edges: number[][] = [[], [0], [0], [1, 2]]
        for (const row of extraEdges)
          edges.push(row.map((id) => id % edges.length))
        const creates = edges.map(() => 0)
        const disposals = edges.map(() => 0)
        const nodes: Extension<Resource>[] = []
        for (const [id, dependencies] of edges.entries()) {
          nodes.push(
            extension({
              key: `resource-${id}`,
              dependencies: Object.fromEntries(
                dependencies.map((dependency, index) => [
                  String(index),
                  nodes[dependency],
                ])
              ),
              create(inputs) {
                const captured = Object.values(inputs)
                expect(captured.map((resource) => resource.id)).toEqual(
                  dependencies
                )
                for (const dependency of captured)
                  expect(dependency.alive).toBe(true)
                const resource: Resource = {
                  id,
                  generation: ++creates[id],
                  dependencies: captured,
                  alive: true,
                }
                return {
                  exports: resource,
                  items: [contribute(resources, () => resource)],
                  dispose: async () => {
                    await Promise.resolve()
                    for (const dependency of captured)
                      expect(dependency.alive).toBe(true)
                    expect(resource.alive).toBe(true)
                    resource.alive = false
                    disposals[id]++
                  },
                }
              },
            })
          )
        }
        let previous = new Map<number, Resource>()
        const expectedCreates = edges.map(() => 0)
        const expectedDisposals = edges.map(() => 0)
        const history = [
          [3],
          [1, 2],
          [2],
          ...rootHistory.map((roots) =>
            roots.map((root) => root % nodes.length)
          ),
          [],
        ]
        try {
          for (const roots of history) {
            const expected = reachable(edges, roots)
            for (const id of expected)
              if (!previous.has(id)) expectedCreates[id]++
            for (const id of previous.keys())
              if (!expected.has(id)) expectedDisposals[id]++
            await registry.configure([roots.map((root) => nodes[root])])
            const actual = new Map(
              registry.get(resources).map((resource) => [resource.id, resource])
            )
            expect([...actual.keys()].sort()).toEqual([...expected].sort())
            expect(creates).toEqual(expectedCreates)
            expect(disposals).toEqual(expectedDisposals)
            for (const [id, resource] of actual) {
              expect(resource.alive).toBe(true)
              if (previous.has(id)) expect(resource).toBe(previous.get(id))
              for (const dependency of resource.dependencies)
                expect(dependency).toBe(actual.get(dependency.id))
            }
            for (const [id, resource] of previous)
              if (!expected.has(id)) expect(resource.alive).toBe(false)
            previous = actual
          }
        } finally {
          await registry.dispose()
        }
        expect(creates).toEqual(disposals)
      }
    ),
    runs
  )
})

it('rolls back newly acquired dependency exports without publishing them or releasing retained resources', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.integer(), { minLength: 1, maxLength: 7 }),
      async (values) => {
        const registry = new Registry()
        const resources = new Facet(
          'resources',
          (inputs: readonly Resource[]) => inputs
        )
        const released: number[] = []
        const created: Resource[] = []
        const observations: number[][] = []
        const stop = effect(() => {
          observations.push(
            registry.get(resources).map((resource) => resource.id)
          )
        })
        const stable = extension({
          key: 'stable',
          create() {
            const resource: Resource = {
              id: -1,
              generation: 1,
              dependencies: [],
              alive: true,
            }
            return {
              exports: resource,
              items: [contribute(resources, () => resource)],
              dispose: () => {
                resource.alive = false
              },
            }
          },
        })
        let capturedStable: Resource | undefined
        const current = extension({
          dependencies: { stable },
          create({ stable }) {
            capturedStable = stable
            const resource: Resource = {
              id: -2,
              generation: 1,
              dependencies: [stable],
              alive: true,
            }
            return {
              exports: resource,
              items: [contribute(resources, () => resource)],
              dispose: () => {
                expect(stable.alive).toBe(true)
                resource.alive = false
              },
            }
          },
        })
        let fail = true
        const failure = new Error('Cannot construct the final child')
        const finalChild = extension({
          create() {
            if (fail) throw failure
            return { exports: {} }
          },
        })
        let dependency: Extension<Resource> = stable
        for (const [id, value] of values.entries()) {
          const previous = dependency
          dependency = extension({
            key: `candidate-${id}`,
            dependencies: { previous, stable },
            create({ previous, stable }) {
              expect(previous.alive).toBe(true)
              expect(stable).toBe(capturedStable)
              const resource: Resource = {
                id,
                generation: value,
                dependencies: [previous, stable],
                alive: true,
              }
              created.push(resource)
              return {
                exports: resource,
                items: [contribute(resources, () => resource)],
                dispose: async () => {
                  await Promise.resolve()
                  expect(previous.alive).toBe(true)
                  expect(stable.alive).toBe(true)
                  resource.alive = false
                  released.push(id)
                },
              }
            },
          })
        }
        const candidate = extension({
          dependencies: { dependency },
          create({ dependency }) {
            expect(dependency.alive).toBe(true)
            return { exports: {}, items: [finalChild] }
          },
        })
        try {
          await registry.configure([current])
          const published = registry.get(resources)
          const before = observations.map((ids) => [...ids])
          await expect(registry.configure([candidate])).rejects.toBe(failure)
          expect(registry.get(resources)).toEqual(published)
          expect(observations).toEqual(before)
          for (const resource of published) expect(resource.alive).toBe(true)
          expect(created).toHaveLength(values.length)
          for (const resource of created) expect(resource.alive).toBe(false)
          expect(released).toEqual(values.map((_, index) => index).toReversed())
          fail = false
          await registry.configure([current, candidate])
          expect(capturedStable).toBe(
            published.find((resource) => resource.id === -1)
          )
          expect(
            registry
              .get(resources)
              .map((resource) => resource.id)
              .sort()
          ).toEqual([-2, -1, ...values.map((_, index) => index)].sort())
        } finally {
          stop()
          await registry.dispose()
        }
      }
    ),
    runs
  )
})

it.each([false, true])(
  'releases consumers, shared children, then owners (reorder roots: %s)',
  async (reorder) => {
    const registry = new Registry()
    const released: string[] = []
    const child = extension({
      create: () => ({
        exports: { alive: true },
        dispose: () => {
          released.push('child')
        },
      }),
    })
    const dependent = extension({
      dependencies: { child },
      create: () => ({
        exports: {},
        dispose: () => {
          released.push('dependent')
        },
      }),
    })
    const owner = extension({
      create: () => ({
        exports: {},
        items: [child],
        dispose: () => {
          released.push('owner')
        },
      }),
    })
    await registry.configure([dependent, owner])
    if (reorder) await registry.configure([owner, dependent])
    expect(released).toEqual([])
    await registry.dispose()
    expect(released).toEqual(['dependent', 'child', 'owner'])
  }
)

it('rejects a keyed dependency alias instead of injecting another definition’s incompatible exports', async () => {
  const registry = new Registry()
  const files = extension({
    key: 'storage',
    create: () => ({ exports: { read: () => 'contents' } }),
  })
  const unrelated = extension({
    key: 'storage',
    create: () => ({ exports: { send: () => undefined } }),
  })
  let acquired = false
  const editor = extension({
    dependencies: { files },
    create({ files }) {
      acquired = true
      return { exports: { contents: files.read() } }
    },
  })
  try {
    await expect(registry.configure([unrelated, editor])).rejects.toThrow()
    expect(acquired).toBe(false)
    await registry.configure([editor])
    expect(acquired).toBe(true)
  } finally {
    await registry.dispose()
  }
})

it('rejects changed dependencies under a retained owner and rolls back their acquisition', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer(), async (value) => {
      const registry = new Registry()
      const published = new Facet(
        'current',
        (inputs: readonly number[]) => inputs
      )
      const released: string[] = []
      const original = extension({
        create: () => ({
          exports: value,
          dispose: () => {
            released.push('original')
          },
        }),
      })
      const replacement = extension({
        create: () => ({
          exports: value + 1,
          dispose: () => {
            released.push('replacement')
          },
        }),
      })
      const consumer = (dependency: Extension<number>) =>
        extension({
          key: 'consumer',
          dependencies: { dependency },
          create: ({ dependency: current }) => ({
            items: [contribute(published, () => current)],
            dispose: () => {
              released.push('consumer')
            },
          }),
        })
      try {
        await registry.configure([consumer(original)])
        await expect(
          registry.configure([consumer(replacement)])
        ).rejects.toThrow('Cannot change dependencies')
        expect(registry.get(published)).toEqual([value])
        expect(released).toEqual(['replacement'])
      } finally {
        await registry.dispose()
      }
      expect(released).toEqual(['replacement', 'consumer', 'original'])
    }),
    runs
  )
})

it('releases returned resources when a child group is recursive', async () => {
  const registry = new Registry()
  const recursive: Item[] = []
  recursive.push(recursive)
  let disposed = false
  const owner = extension({
    create: () => ({
      items: recursive,
      dispose: () => {
        disposed = true
      },
    }),
  })
  await expect(registry.configure([owner])).rejects.toThrow(
    'Cyclic item dependency'
  )
  expect(disposed).toBe(true)
  await registry.dispose()
})

it('captures exports once so every alias and consumer receives the same value', async () => {
  const registry = new Registry()
  const captured: object[] = []
  let reads = 0
  const dependency = extension({
    create: () => ({
      get exports() {
        return { generation: ++reads }
      },
    }),
  })
  const consumer = () =>
    extension({
      dependencies: { first: dependency, second: dependency },
      create: ({ first, second }) => {
        captured.push(first, second)
        return {}
      },
    })
  try {
    await registry.configure([consumer(), consumer()])
    expect(reads).toBe(1)
    expect(captured).toHaveLength(4)
    for (const value of captured) expect(value).toBe(captured[0])
  } finally {
    await registry.dispose()
  }
})

it('releases acquired resources when capturing exports throws', async () => {
  const registry = new Registry()
  let disposed = false
  const owner = extension({
    create: () => ({
      get exports(): never {
        throw new Error('exports failed')
      },
      dispose: () => {
        disposed = true
      },
    }),
  })
  await expect(registry.configure([owner])).rejects.toThrow('exports failed')
  expect(disposed).toBe(true)
  await registry.dispose()
})
