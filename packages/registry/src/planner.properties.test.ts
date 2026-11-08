import fc from 'fast-check'
import { expect, it } from 'vitest'
import type { Item, Subtree } from './algebra'
import { slot } from './algebra'
import { DependencyCycleError, plan } from './planner'

const runs = { numRuns: 300 }
const neverCreate = (): never => {
  throw new Error('Planning must not call create')
}
const neverInstall = (): never => {
  throw new Error('Planning must not install bindings')
}

// Lower-index edges construct DAGs with shared dependencies and duplicate edges.
const dag = fc
  .tuple(
    fc.array(
      fc.record({
        kind: fc.constantFrom('binding', 'group', 'subtree'),
        edges: fc.array(fc.nat({ max: 20 }), { maxLength: 3 }),
      }),
      { minLength: 1, maxLength: 8 }
    ),
    fc.array(fc.nat({ max: 20 }), { maxLength: 8 })
  )
  .map(([rows, rootIndices]) => {
    const graph = rows.map((row, index) => ({
      kind: row.kind,
      edges:
        index === 0 || row.kind === 'binding'
          ? []
          : row.edges.map((edge) => edge % index),
    }))
    const nodes: Item[] = []
    for (const row of graph) {
      const children = Object.freeze(row.edges.map((edge) => nodes[edge]))
      nodes.push(
        Object.freeze(
          row.kind === 'binding'
            ? { install: neverInstall }
            : row.kind === 'group'
              ? children
              : { dependencies: children, create: neverCreate }
        )
      )
    }
    const roots = rootIndices.map((root) => root % nodes.length)
    return { graph, nodes, roots }
  })

it('matches expanded declaration order with first occurrence retained', () => {
  fc.assert(
    fc.property(dag, ({ graph, nodes, roots }) => {
      // A deliberately unoptimized oracle expands every occurrence, then deduplicates.
      const expanded: { index: number; path: string }[] = []
      const expand = (index: number, path: string): void => {
        const row = graph[index]
        for (const [position, edge] of row.edges.entries()) {
          expand(
            edge,
            `${path}/${row.kind === 'group' ? 'items' : 'dependencies'}[${position}]`
          )
        }
        if (row.kind !== 'group') expanded.push({ index, path })
      }
      roots.forEach((root, index) => expand(root, `root[${index}]`))
      const expected = expanded.filter(
        (entry, index) =>
          expanded.findIndex((other) => other.index === entry.index) === index
      )
      const actual = plan(Object.freeze(roots.map((root) => nodes[root])))

      expect(actual).toHaveLength(expected.length)
      for (const [index, entry] of expected.entries()) {
        expect(actual[index].item).toBe(nodes[entry.index])
        expect(actual[index].path).toBe(entry.path)
      }
    }),
    runs
  )
})

it('appending repeated roots cannot change the selected items or their provenance', () => {
  fc.assert(
    fc.property(dag, ({ nodes, roots }) => {
      const items = roots.map((root) => nodes[root])
      expect(plan([...items, ...items])).toEqual(plan(items))
    }),
    runs
  )
})

it('keeps distinct subtree objects even when their definitions are identical', () => {
  fc.assert(
    fc.property(fc.nat({ max: 30 }), (length) => {
      const items = Array.from({ length }, () => ({ create: neverCreate }))
      const actual = plan(items)
      expect(actual).toHaveLength(items.length)
      items.forEach((item, index) => expect(actual[index].item).toBe(item))
    }),
    runs
  )
})

it('rejects exactly the reachable cyclic graphs according to dependency elimination', () => {
  fc.assert(
    fc.property(
      fc.array(fc.array(fc.nat({ max: 20 }), { maxLength: 4 }), {
        minLength: 1,
        maxLength: 9,
      }),
      fc.array(fc.nat({ max: 20 }), { maxLength: 9 }),
      (rows, rootIndices) => {
        const edges = rows.map((row) => row.map((edge) => edge % rows.length))
        const roots = rootIndices.map((root) => root % rows.length)
        const nodes = rows.map(() => ({
          create: neverCreate,
          dependencies: [] as Item[],
        }))
        edges.forEach((dependencies, index) => {
          nodes[index].dependencies.push(
            ...dependencies.map((edge) => nodes[edge])
          )
          Object.freeze(nodes[index].dependencies)
          Object.freeze(nodes[index])
        })

        // Reachability plus repeated removal of dependency-free vertices is an
        // independent cycle oracle; it has no DFS stack or active-path bookkeeping.
        const reachable = new Set(roots)
        for (const vertex of reachable) {
          edges[vertex].forEach((dependency) => reachable.add(dependency))
        }
        const remaining = new Set(reachable)
        while (remaining.size) {
          const ready = [...remaining].filter((vertex) =>
            edges[vertex].every((dependency) => !remaining.has(dependency))
          )
          if (!ready.length) break
          ready.forEach((vertex) => remaining.delete(vertex))
        }

        const items = roots.map((root) => nodes[root])
        if (remaining.size) {
          expect(() => plan(items)).toThrow(DependencyCycleError)
        } else {
          const actual = plan(items)
          const positions = new Map(
            actual.map((entry, index) => [entry.item, index])
          )
          expect(actual).toHaveLength(reachable.size)
          for (const vertex of reachable) {
            expect(positions.has(nodes[vertex])).toBe(true)
            for (const dependency of edges[vertex]) {
              expect(positions.get(nodes[dependency])).toBeLessThan(
                positions.get(nodes[vertex])!
              )
            }
          }
        }
      }
    ),
    runs
  )
})

it('reports the active path for cycles through groups and dependencies', () => {
  const group: Item[] = []
  const owner: Subtree = { create: neverCreate, dependencies: [group] }
  group.push(owner)
  let failure: unknown
  try {
    plan([owner])
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(DependencyCycleError)
  if (!(failure instanceof DependencyCycleError)) throw failure
  expect(failure.paths).toEqual([
    'root[0]',
    'root[0]/dependencies[0]',
    'root[0]/dependencies[0]/items[0]',
  ])
})

it('rejects recursive groups without mistaking shared groups for cycles', () => {
  const recursive: Item[] = []
  recursive.push(recursive)
  expect(() => plan([recursive])).toThrow(DependencyCycleError)
  const binding = { install: neverInstall }
  const shared = [binding]
  expect(plan([shared, shared])).toEqual([
    { item: binding, path: 'root[0]/items[0]' },
  ])
})

it('does not inspect slot children or invoke even a create getter', () => {
  const hiddenCycle: Item[] = []
  hiddenCycle.push(hiddenCycle)
  const container = slot(hiddenCycle)
  const owner: Subtree = {
    dependencies: [container],
    get create(): Subtree['create'] {
      throw new Error('Do not inspect acquisition')
    },
  }
  expect(plan([owner])).toEqual([
    { item: container, path: 'root[0]/dependencies[0]' },
    { item: owner, path: 'root[0]' },
  ])
})
