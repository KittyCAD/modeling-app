import { homeProjectEntryFromProject } from '@src/lib/homeProjects'
import type { FileMetadata, Project } from '@src/lib/project'
import { describe, expect, test } from 'vitest'

function metadata(modified: number): FileMetadata {
  return {
    accessed: null,
    created: null,
    modified,
    permission: null,
    size: 0,
    type: null,
  }
}

describe('homeProjectEntryFromProject', () => {
  test('uses the newest child modified time for local project cards', () => {
    const project = {
      name: 'project',
      path: '/projects/project',
      title: 'Project',
      default_file: '/projects/project/main.kcl',
      readWriteAccess: true,
      metadata: metadata(10),
      kcl_file_count: 1,
      directory_count: 0,
      children: [
        {
          name: 'main.kcl',
          path: '/projects/project/main.kcl',
          metadata: metadata(50),
          children: null,
        },
      ],
    } satisfies Project

    expect(homeProjectEntryFromProject(project).modified).toBe(50)
  })
})
