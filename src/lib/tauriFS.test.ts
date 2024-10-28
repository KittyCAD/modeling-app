import {
  getNextProjectIndex,
  interpolateProjectNameWithIndex,
} from './desktopFS'
import { MAX_PADDING } from './constants'

describe('Test project name utility functions', () => {
  it('interpolates a project name without an index', () => {
    expect(interpolateProjectNameWithIndex('test', 1)).toBe('test')
  })

  it('interpolates a project name with an index and no padding', () => {
    expect(interpolateProjectNameWithIndex('test-$n', 2)).toBe('test-2')
  })

  it('interpolates a project name with an index and padding', () => {
    expect(interpolateProjectNameWithIndex('test-$nnn', 12)).toBe('test-012')
  })

  it('interpolates a project name with an index and max padding', () => {
    expect(interpolateProjectNameWithIndex('test-$nnnnnnnnnnn', 3)).toBe(
      `test-${'0'.repeat(MAX_PADDING)}3`
    )
  })

  const testFiles = [
    {
      name: 'new-project-04.kcl',
      path: '/projects/new-project-04.kcl',
      children: [],
    },
    {
      name: 'new-project-007.kcl',
      path: '/projects/new-project-007.kcl',
      children: [],
    },
    {
      name: 'new-project-05.kcl',
      path: '/projects/new-project-05.kcl',
      children: [],
    },
    {
      name: 'new-project-0.kcl',
      path: '/projects/new-project-0.kcl',
      children: [],
    },
  ]

  it('gets the correct next project index', () => {
    expect(getNextProjectIndex('new-project-$n', testFiles)).toBe(8)
  })
})
