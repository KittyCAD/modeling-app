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
  it('uses the loaded project while folder hydration is pending', () => {
    const loadedProject = project('demo', [
      {
        name: 'main.kcl',
        path: '/projects/demo/main.kcl',
        children: null,
      },
    ])

    const explorerProject = getProjectExplorerProjectWithPlaceholders({
      loadedProject,
    })

    expect(explorerProject?.children?.map((child) => child.name)).toEqual([
      FOLDER_PLACEHOLDER_NAME,
      'main.kcl',
      FILE_PLACEHOLDER_NAME,
    ])
    expect(loadedProject.children?.map((child) => child.name)).toEqual([
      'main.kcl',
    ])
  })

  it('uses the opened project as the source of truth', () => {
    const loadedProject = project('demo', [
      {
        name: 'stale.kcl',
        path: '/projects/demo/stale.kcl',
        children: null,
      },
    ])
    const explorerProject = getProjectExplorerProjectWithPlaceholders({
      loadedProject,
    })

    expect(explorerProject?.children?.map((child) => child.name)).toEqual([
      FOLDER_PLACEHOLDER_NAME,
      'stale.kcl',
      FILE_PLACEHOLDER_NAME,
    ])
  })
})
