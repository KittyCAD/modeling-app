import { FileEntry } from '@tauri-apps/api/fs'
import {
  MAX_PADDING,
  deepFileFilter,
  getNextProjectIndex,
  interpolateProjectNameWithIndex,
  isRelevantFileOrDir,
  readProject,
} from './tauriFS'

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
    },
    {
      name: 'new-project-007.kcl',
      path: '/projects/new-project-007.kcl',
    },
    {
      name: 'new-project-05.kcl',
      path: '/projects/new-project-05.kcl',
    },
    {
      name: 'new-project-0.kcl',
      path: '/projects/new-project-0.kcl',
    },
  ]

  it('gets the correct next project index', () => {
    expect(getNextProjectIndex('new-project-$n', testFiles)).toBe(8)
  })
})

describe('Test file tree utility functions', () => {
  const baseFiles: FileEntry[] = [
    {
      name: 'show-me.kcl',
      path: '/projects/show-me.kcl',
    },
    {
      name: 'hide-me.jpg',
      path: '/projects/hide-me.jpg',
    },
    {
      name: '.gitignore',
      path: '/projects/.gitignore',
    },
  ]

  const filteredBaseFiles: FileEntry[] = [
    {
      name: 'show-me.kcl',
      path: '/projects/show-me.kcl',
    },
  ]

  it('Only includes files relevant to the project in a flat directory', () => {
    expect(deepFileFilter(baseFiles, isRelevantFileOrDir)).toEqual(
      filteredBaseFiles
    )
  })

  const nestedFiles: FileEntry[] = [
    ...baseFiles,
    {
      name: 'show-me',
      path: '/projects/show-me',
      children: [
        {
          name: 'show-me-nested',
          path: '/projects/show-me/show-me-nested',
          children: baseFiles,
        },
        {
          name: 'hide-me',
          path: '/projects/show-me/hide-me',
          children: baseFiles.filter((file) => file.name !== 'show-me.kcl'),
        },
      ],
    },
    {
      name: 'hide-me',
      path: '/projects/hide-me',
      children: baseFiles.filter((file) => file.name !== 'show-me.kcl'),
    },
  ]

  const filteredNestedFiles: FileEntry[] = [
    ...filteredBaseFiles,
    {
      name: 'show-me',
      path: '/projects/show-me',
      children: [
        {
          name: 'show-me-nested',
          path: '/projects/show-me/show-me-nested',
          children: filteredBaseFiles,
        },
      ],
    },
  ]

  it('Only includes directories that include files relevant to the project in a nested directory', () => {
    expect(deepFileFilter(nestedFiles, isRelevantFileOrDir)).toEqual(
      filteredNestedFiles
    )
  })

  const withHiddenDir: FileEntry[] = [
    ...baseFiles,
    {
      name: '.hide-me',
      path: '/projects/.hide-me',
      children: baseFiles,
    },
  ]

  it(`Hides folders that begin with a ".", even if they contain relevant files`, () => {
    expect(deepFileFilter(withHiddenDir, isRelevantFileOrDir)).toEqual(
      filteredBaseFiles
    )
  })
})
