import { expect, it } from 'vitest'
import fc from 'fast-check'
import type { ToolbarViewItem } from '@src/components/Toolbar/ToolbarView'
import {
  fitToolbar,
  groupToolbarItems,
  projectToolbar,
  toolbarLeaves,
  type ToolbarNode,
} from '@src/components/Toolbar/groups'

const tool = (id: string): ToolbarViewItem => ({
  id,
  title: id,
  status: 'available',
  description: '',
  links: [],
  onClick: () => {},
})
const tree: ToolbarNode[] = [
  {
    id: 'all',
    title: 'All',
    children: [
      {
        id: 'sketch',
        title: 'Sketch',
        children: [tool('circle'), tool('line')],
      },
      {
        id: 'solid',
        title: 'Solid',
        collapsePriority: 1,
        children: [tool('extrude'), tool('loft')],
      },
    ],
  },
]
const widths = new Map([
  ['tool:circle', 40],
  ['tool:line', 40],
  ['tool:extrude', 40],
  ['tool:loft', 40],
  ['group:sketch', 50],
  ['group:solid', 50],
  ['group:all', 50],
])

it('preserves all commands and their order at every collapse level without stray dividers', () => {
  fc.assert(
    fc.property(fc.subarray(['all', 'sketch', 'solid']), (ids) => {
      const projected = projectToolbar(tree, new Set(ids), new Map())
      const commands = projected.flatMap((entry) =>
        entry === 'break'
          ? []
          : 'group' in entry
            ? toolbarLeaves(entry.group.children).map((item) => item.id)
            : [entry.id]
      )
      expect(commands).toEqual(['circle', 'line', 'extrude', 'loft'])
      expect(projected[0]).not.toBe('break')
      expect(projected.at(-1)).not.toBe('break')
      expect(
        projected.some(
          (entry, index) =>
            entry === 'break' && projected[index + 1] === 'break'
        )
      ).toBe(false)
    })
  )
})
it('collapses the prioritized sibling before its parent and expands again when space returns', () => {
  expect([...fitToolbar(tree, 155, widths, new Map(), 6, 18)]).toEqual([
    'solid',
    'sketch',
  ])
  expect([...fitToolbar(tree, 90, widths, new Map(), 6, 18)]).toEqual([
    'solid',
    'sketch',
    'all',
  ])
  expect([...fitToolbar(tree, 500, widths, new Map(), 6, 18)]).toEqual([])
})
it('retains the last used descendant as the primary command of every collapsed ancestor', () => {
  const projection = projectToolbar(
    tree,
    new Set(['all']),
    new Map([['all', 'loft']])
  )
  expect(projection).toHaveLength(1)
  expect(projection[0]).toMatchObject({ selected: { id: 'loft' } })
})
it('prunes empty contributed categories and rejects missing parents and cycles', () => {
  expect(
    groupToolbarItems([tool('circle')], [{ id: 'empty', title: 'Empty' }])
  ).toEqual(
    [tool('circle')].map((item) => expect.objectContaining({ id: item.id }))
  )
  expect(
    groupToolbarItems([], [{ id: 'a', title: 'A', parentId: 'missing' }])
  ).toBeInstanceOf(Error)
  expect(
    groupToolbarItems(
      [],
      [
        { id: 'a', title: 'A', parentId: 'b' },
        { id: 'b', title: 'B', parentId: 'a' },
      ]
    )
  ).toBeInstanceOf(Error)
  expect(
    projectToolbar(
      [{ id: 'empty', title: 'Empty', children: [] }],
      new Set(['empty']),
      new Map()
    )
  ).toEqual([])
})
it('keeps stable group order and omits categories belonging to other interactions', () => {
  const items = [
    { ...tool('loft'), groupId: 'solids' },
    { ...tool('start'), groupId: 'sketch' },
  ]
  const result = groupToolbarItems(items, [
    { id: 'solids', title: 'Solids', order: 1 },
    { id: 'sketch', title: 'Sketch', order: 0 },
    { id: 'unused', title: 'Unused' },
  ])
  expect(result).not.toBeInstanceOf(Error)
  if (result instanceof Error) throw result
  expect(result.map((item) => item.id)).toEqual(['sketch', 'solids'])
})
