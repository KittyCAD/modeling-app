import type { Project } from '@src/lib/project'
import { getSortFunction } from '@src/lib/sorting'
import { describe, expect, it } from 'vitest'

function project(name: string, modified?: number): Project {
  return {
    name,
    path: `/projects/${name}`,
    children: [],
    default_file: `/projects/${name}/main.kcl`,
    directory_count: 0,
    kcl_file_count: 1,
    metadata:
      modified === undefined
        ? null
        : {
            accessed: null,
            created: null,
            modified,
            permission: null,
            size: 0,
            type: 'directory',
          },
    readWriteAccess: true,
  }
}

describe('project sorting', () => {
  it('sorts modified-desc projects before unknown dates and falls back to name', () => {
    expect(
      [
        project('unknown-z'),
        project('older', 10),
        project('newest', 30),
        project('unknown-a'),
      ]
        .toSorted(getSortFunction('modified:desc'))
        .map((entry) => entry.name)
    ).toEqual(['newest', 'older', 'unknown-a', 'unknown-z'])
  })
})
