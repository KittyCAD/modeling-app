import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  buildFeatureTreeModel,
  type FeatureTreeNode,
} from './feature-tree-model'

/** An ancestor-path oracle avoids reproducing the model's stack traversal. */
function expectedEntries(
  nodes: readonly FeatureTreeNode[],
  expanded: string[]
) {
  const path = (node: FeatureTreeNode) => {
    const ancestors = [node]
    while (ancestors[0].parentId !== undefined) {
      ancestors.unshift(
        nodes.find((candidate) => candidate.id === ancestors[0].parentId)!
      )
    }
    return ancestors
  }
  const siblings = (node: FeatureTreeNode) =>
    nodes.filter((candidate) => candidate.parentId === node.parentId)
  const isLast = (node: FeatureTreeNode) =>
    siblings(node).at(-1)!.id === node.id
  const order = (node: FeatureTreeNode) =>
    path(node).map((ancestor) => nodes.indexOf(ancestor))
  const sorted = [...nodes].sort((left, right) => {
    const a = order(left)
    const b = order(right)
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      if (a[index] !== b[index]) return a[index] - b[index]
    }
    return a.length - b.length
  })
  return sorted.map((node) => ({
    entry: {
      ...node,
      depth: path(node).length - 1,
      childIds: nodes
        .filter((candidate) => candidate.parentId === node.id)
        .map((candidate) => candidate.id),
      posInSet: siblings(node).indexOf(node) + 1,
      setSize: siblings(node).length,
      lastSibling: isLast(node),
      guides: path(node)
        .slice(1)
        .map((ancestor) => !isLast(ancestor)),
    },
    visible: path(node)
      .slice(0, -1)
      .every((ancestor) => expanded.includes(ancestor.id)),
  }))
}

describe('flat feature tree model', () => {
  it('keeps all entries while projecting expansion and sibling guide metadata', () => {
    const nodes = [
      { id: 'a', label: 'First' },
      { id: 'b', parentId: 'a', label: 'Branch' },
      { id: 'c', parentId: 'b', label: 'Leaf', disabled: true },
      { id: 'd', parentId: 'b', label: 'Last leaf' },
      { id: 'e', parentId: 'a', label: 'Last branch' },
      { id: 'f', label: 'Second' },
    ]
    const model = buildFeatureTreeModel(nodes, ['a'])
    expect([...model.entries.keys()]).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(model.visible.map((entry) => entry.id)).toEqual(['a', 'b', 'e', 'f'])
    expect(model.entries.get('c')).toEqual({
      ...nodes[2],
      depth: 2,
      childIds: [],
      posInSet: 1,
      setSize: 2,
      lastSibling: false,
      guides: [true, true],
    })
    expect(model.entries.get('d')!.guides).toEqual([true, false])
    expect(model.entries.get('e')!.guides).toEqual([false])
    expect(model.entries.get('a')!.guides).toEqual([])
  })

  it('accepts children before parents and preserves input order among siblings', () => {
    const nodes = [
      { id: 'last', parentId: 'root', label: 'First in input' },
      { id: 'child', parentId: 'last', label: 'Grandchild' },
      { id: 'root', label: 'Root' },
      { id: 'first', parentId: 'root', label: 'Second in input' },
    ]
    const model = buildFeatureTreeModel(nodes, ['root', 'last'])
    expect(model.visible.map((entry) => entry.id)).toEqual([
      'root',
      'last',
      'child',
      'first',
    ])
    expect(model.entries.get('root')!.childIds).toEqual(['last', 'first'])
    expect(buildFeatureTreeModel([], []).visible).toEqual([])
  })

  it.each([
    { nodes: [{ id: '', label: '' }], message: /empty/i },
    { nodes: [{ id: '  ', label: '' }], message: /empty/i },
    {
      nodes: [
        { id: 'same', label: 'One' },
        { id: 'same', label: 'Two' },
      ],
      message: /duplicate.*same/i,
    },
    {
      nodes: [{ id: 'child', parentId: 'missing', label: '' }],
      message: /child.*missing parent.*missing/i,
    },
    {
      nodes: [{ id: 'self', parentId: 'self', label: '' }],
      message: /cycle.*self/i,
    },
    {
      nodes: [
        { id: 'root', label: '' },
        { id: 'one', parentId: 'two', label: '' },
        { id: 'two', parentId: 'one', label: '' },
      ],
      message: /cycle/i,
    },
  ])('rejects malformed records: $message', ({ nodes, message }) => {
    expect(() => buildFeatureTreeModel(nodes, [])).toThrow(TypeError)
    expect(() => buildFeatureTreeModel(nodes, [])).toThrow(message)
  })

  it('handles deep hierarchies without recursive calls', () => {
    const nodes = Array.from({ length: 2500 }, (_, index) => ({
      id: String(index),
      parentId: index === 0 ? undefined : String(index - 1),
      label: String(index),
    }))
    const model = buildFeatureTreeModel(
      nodes,
      nodes.map((node) => node.id)
    )
    expect(model.visible).toHaveLength(nodes.length)
    expect(model.entries.get('2499')!.depth).toBe(2499)
  })

  it('matches ancestor paths across reordered forests and expansion changes', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            parent: fc.nat(),
            order: fc.integer(),
            disabled: fc.boolean(),
            label: fc.string(),
          }),
          { maxLength: 45 }
        ),
        fc.array(fc.array(fc.nat(50), { maxLength: 50 }), { maxLength: 8 }),
        (specs, expansions) => {
          const nodes = specs
            .map((spec, index) => {
              const parent = spec.parent % (index + 1)
              return {
                id: String(index),
                parentId: parent === index ? undefined : String(parent),
                label: spec.label,
                disabled: spec.disabled,
              }
            })
            .sort(
              (a, b) => specs[Number(a.id)].order - specs[Number(b.id)].order
            )
          for (const ids of [[], ...expansions]) {
            const expanded = ids.map(String)
            const expected = expectedEntries(nodes, expanded)
            const model = buildFeatureTreeModel(nodes, expanded)
            expect([...model.entries.values()]).toEqual(
              expected.map(({ entry }) => entry)
            )
            expect(model.visible).toEqual(
              expected
                .filter(({ visible }) => visible)
                .map(({ entry }) => entry)
            )
          }
        }
      ),
      { numRuns: 150 }
    )
  })
})
