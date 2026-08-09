import {
  FILE_PLACEHOLDER_NAME,
  FOLDER_PLACEHOLDER_NAME,
} from '@src/components/Explorer/placeholders'
import { getProjectExplorerProjectWithPlaceholders } from '@src/components/layout/areas/ProjectExplorerPane.utils'
import type { Project } from '@src/lib/project'
import { describe, expect, it } from 'vitest'

const project = (name: string, children: Project['children']): Project => ({
  metadata: null,
  kcl_file_count: 1,
  directory_count: 0,
  default_file: `/projects/${name}/main.kcl`,
  path: `/projects/${name}`,
  name,
  children,
  readWriteAccess: true,
})

describe('getProjectExplorerProjectWithPlaceholders', () => {
  it('duplicates the project tree and adds create placeholders', () => {
    const sourceProject = project('demo', [
      {
        name: 'main.kcl',
        path: '/projects/demo/main.kcl',
        children: null,
      },
    ])

    const explorerProject = getProjectExplorerProjectWithPlaceholders({
      project: sourceProject,
    })

    expect(explorerProject?.children?.map((child) => child.name)).toEqual([
      FOLDER_PLACEHOLDER_NAME,
      'main.kcl',
      FILE_PLACEHOLDER_NAME,
    ])
    expect(sourceProject.children?.map((child) => child.name)).toEqual([
      'main.kcl',
    ])
  })
})
