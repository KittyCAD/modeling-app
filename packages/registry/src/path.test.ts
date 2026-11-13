import { expect, it } from 'vitest'
import { formatPath } from './path'

it('formats mixed edges without losing their indices', () => {
  expect(formatPath([12, ['dependencies', 'files'], ['items', 10]])).toBe(
    'root[12]/dependencies["files"]/items[10]'
  )
})
