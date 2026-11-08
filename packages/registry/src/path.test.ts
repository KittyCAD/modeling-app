import { assertType, expect, it } from 'vitest'
import { formatPath, type ItemPath } from './path'

it('formats roots and mixed edges without losing their indices', () => {
  expect(formatPath([0])).toBe('root[0]')
  expect(formatPath([12, ['dependencies', 3], ['items', 10]])).toBe(
    'root[12]/dependencies[3]/items[10]'
  )
})

it('requires a root, legal edges, numeric indices, and readonly steps', () => {
  // @ts-expect-error Every path must begin at a root.
  assertType<ItemPath>([])
  // @ts-expect-error Arbitrary edge names are not graph paths.
  assertType<ItemPath>([0, ['children', 1]])
  // @ts-expect-error Indices are numeric.
  assertType<ItemPath>(['0'])
  // @ts-expect-error Child indices are numeric too.
  assertType<ItemPath>([0, ['items', '1']])

  assertType<(path: ItemPath) => void>((path) => {
    // @ts-expect-error Paths expose no mutable root.
    path[0] = 1
    const step = path[1]
    if (step) {
      // @ts-expect-error Step tuples expose no mutable index.
      step[1] = 1
    }
  })
})
