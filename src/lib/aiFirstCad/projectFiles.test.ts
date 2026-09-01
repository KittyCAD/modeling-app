import { getProjectKclFiles } from '@src/lib/aiFirstCad/projectFiles'
import type { FileEntry, Project } from '@src/lib/project'
import { describe, expect, it } from 'vitest'

const metadata = {
  accessed: null,
  created: null,
  modified: null,
  permission: null,
  size: 0,
  type: null,
}

const file = (name: string, path: string): FileEntry => ({
  children: null,
  name,
  path,
})

const project: Project = {
  children: [
    file('main.kcl', '/projects/robot/main.kcl'),
    file('README.md', '/projects/robot/README.md'),
    {
      children: [
        file('wrist.KCL', '/projects/robot/parts/wrist.KCL'),
        file('notes.txt', '/projects/robot/parts/notes.txt'),
      ],
      name: 'parts',
      path: '/projects/robot/parts',
    },
  ],
  default_file: '/projects/robot/main.kcl',
  directory_count: 1,
  kcl_file_count: 2,
  metadata,
  name: 'robot',
  path: '/projects/robot',
  readWriteAccess: true,
}

describe('getProjectKclFiles', () => {
  it('returns every nested KCL file as a sorted project-relative path', () => {
    expect(getProjectKclFiles(project)).toEqual([
      { label: 'main.kcl', path: '/projects/robot/main.kcl' },
      {
        label: 'parts/wrist.KCL',
        path: '/projects/robot/parts/wrist.KCL',
      },
    ])
  })
})
