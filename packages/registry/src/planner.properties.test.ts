import fc from 'fast-check'
import { expect, it } from 'vitest'
import { extension, type Extension, type Item, slot } from './algebra'
import { formatPath } from './path'
import { DependencyCycleError, plan } from './planner'

const runs = { numRuns: 300 }
const neverCreate = (): never => {
  throw new Error('Planning must not call create')
}
const neverInstall = (): never => {
  throw new Error('Planning must not install bindings')
}

// Extensions depend on earlier extensions; root groups also exercise flattening.
const dag = fc
  .tuple(
    fc.array(fc.array(fc.nat({ max: 20 }), { maxLength: 3 }), {
      minLength: 1,
      maxLength: 8,
    }),
    fc.array(fc.nat({ max: 20 }), { maxLength: 8 })
  )
  .map(([rows, rootIndices]) => {
    const edges = rows.map((row, index) =>
      index ? row.map((edge) => edge % index) : []
    )
    const nodes: Extension[] = []
    for (const dependencies of edges) {
      nodes.push(
        extension({
          dependencies: Object.fromEntries(
            dependencies.map((edge, index) => [
              `dependency${index}`,
              nodes[edge],
            ])
          ),
          create: neverCreate,
        })
      )
    }
    const roots = rootIndices.map((root) => root % nodes.length)
    return { edges, nodes, roots }
  })

it('matches expanded declaration order with first occurrence retained', () => {
  fc.assert(
    fc.property(dag, ({ edges, nodes, roots }) => {
      // Expand all paths before deduplicating, independently of the planner's DFS.
      const expanded: { index: number; path: string }[] = []
      const expand = (index: number, path: string): void => {
        for (const [position, edge] of edges[index].entries()) {
          expand(edge, `${path}/dependencies["dependency${position}"]`)
        }
        expanded.push({ index, path })
      }
      roots.forEach((root, index) => expand(root, `root[0]/items[${index}]`))
      const expected = expanded.filter(
        (entry, index) =>
          expanded.findIndex((other) => other.index === entry.index) === index
      )
      const actual = plan([Object.freeze(roots.map((root) => nodes[root]))])
      expect(actual).toHaveLength(expected.length)
      expected.forEach((entry, index) => {
        expect(actual[index].item).toBe(nodes[entry.index])
        expect(formatPath(actual[index].path)).toBe(entry.path)
      })
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

it('keeps distinct extension objects even when their definitions are identical', () => {
  fc.assert(
    fc.property(fc.nat({ max: 30 }), (length) => {
      const items = Array.from({ length }, () =>
        extension({ create: neverCreate })
      )
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
        const nodes: {
          create: typeof neverCreate
          dependencies: Record<string, Extension>
        }[] = rows.map(() => ({
          create: neverCreate,
          dependencies: {},
        }))
        edges.forEach((dependencies, index) => {
          dependencies.forEach((edge, position) => {
            nodes[index].dependencies[`dependency${position}`] = nodes[edge]
          })
          Object.freeze(nodes[index].dependencies)
          Object.freeze(nodes[index])
        })
        // Repeated dependency-free elimination gives an independent cycle oracle.
        const reachable = new Set(roots)
        for (const vertex of reachable)
          edges[vertex].forEach((dependency) => reachable.add(dependency))
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
            for (const dependency of edges[vertex])
              expect(positions.get(nodes[dependency])).toBeLessThan(
                positions.get(nodes[vertex])!
              )
          }
        }
      }
    ),
    runs
  )
})

it('reports the active path for a named dependency cycle', () => {
  const dependencies: Record<string, Extension> = {}
  const owner = { create: neverCreate, dependencies }
  const dependency = { create: neverCreate, dependencies: { owner } }
  dependencies.files = dependency
  let failure: unknown
  try {
    plan([owner])
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(DependencyCycleError)
  if (!(failure instanceof DependencyCycleError)) throw failure
  expect(failure.message).toBe(
    'Cyclic item dependency: root[0] -> root[0]/dependencies["files"] -> root[0]/dependencies["files"]/dependencies["owner"]'
  )
  expect(failure.paths).toEqual([
    [0],
    [0, ['dependencies', 'files']],
    [0, ['dependencies', 'files'], ['dependencies', 'owner']],
  ])
})

it('rejects recursive groups without mistaking shared groups for cycles', () => {
  const recursive: Item[] = []
  recursive.push(recursive)
  expect(() => plan([recursive])).toThrow(DependencyCycleError)
  const binding = { install: neverInstall }
  const shared = [binding]
  expect(plan([shared, shared])).toEqual([
    { item: binding, path: [0, ['items', 0]] },
  ])
})

it('does not inspect slot children or invoke even a create getter', () => {
  const hiddenCycle: Item[] = []
  hiddenCycle.push(hiddenCycle)
  const container = slot(hiddenCycle)
  const owner: Extension = {
    dependencies: { container },
    get create(): Extension['create'] {
      throw new Error('Do not inspect acquisition')
    },
  }
  expect(plan([owner])).toEqual([
    { item: container, path: [0, ['dependencies', 'container']] },
    { item: owner, path: [0] },
  ])
})

it('structured paths navigate back to their exact item using valid edge names and indices', () => {
  fc.assert(
    fc.property(dag, ({ nodes, roots }) => {
      const items: readonly Item[] = [roots.map((root) => nodes[root])]
      for (const entry of plan(items)) {
        const [root, ...steps] = entry.path
        expect(Number.isInteger(root) && root >= 0).toBe(true)
        let item: Item = items[root]
        for (const [edge, position] of steps) {
          if (edge === 'dependencies') {
            if (!('create' in item) || !('dependencies' in item))
              throw new Error('Dependency edge requires an extension')
            expect(Object.hasOwn(item.dependencies!, position)).toBe(true)
            item = item.dependencies![position]
          } else {
            expect(Number.isInteger(position) && position >= 0).toBe(true)
            if ('create' in item || 'install' in item)
              throw new Error('Item edge requires a group')
            item = item[position]
          }
        }
        expect(item).toBe(entry.item)
      }
    }),
    runs
  )
})
