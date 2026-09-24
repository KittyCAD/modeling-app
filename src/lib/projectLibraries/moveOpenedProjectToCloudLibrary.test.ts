import type { App } from '@src/lib/app'
import type { Project } from '@src/lib/project'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
} from '@src/lib/projectLibraries'
import { moveOpenedProjectToCloudLibrary } from '@src/lib/projectLibraries/moveOpenedProjectToCloudLibrary'
import {
  appNavigationService,
  openProjectIntent,
} from '@src/registry/contracts/appNavigation'
import type {
  HomeProjectActionsService,
  HomeProjectEntry,
  HomeProjectMoveToLibraryTarget,
} from '@src/registry/contracts/homeProjects'
import {
  homeProjectActionsService,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import { expect, test, vi } from 'vitest'

const { writeProjectTitleToProjectToml } = vi.hoisted(() => ({
  writeProjectTitleToProjectToml: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@src/lib/desktop', () => ({
  writeProjectTitleToProjectToml,
}))

test('moves an open directory project before navigating directly to its new file', async () => {
  const project = {
    path: '/projects/example',
    libraryType: DIRECTORY_PROJECT_LIBRARY_TYPE,
  } as Project
  const homeProject = {
    localProjectPath: project.path,
    name: 'example',
  } as HomeProjectEntry
  const cloudLibraryTarget = {
    library: {
      id: 'personal-cloud',
      type: CLOUD_PROJECT_LIBRARY_TYPE,
    },
  } as HomeProjectMoveToLibraryTarget
  const moveToLibrary = vi.fn().mockResolvedValue({
    defaultFile: '/cloud/example/main.kcl',
    localProjectPath: '/cloud/example',
  })
  const actions = {
    getMoveToLibraryTargets: vi.fn().mockReturnValue([cloudLibraryTarget]),
    moveToLibrary,
  } as unknown as HomeProjectActionsService
  const closeProject = vi.fn()
  const clearProjectSettings = vi.fn()
  const fileOperations = {} as App['fileOperations']
  const dispatch = vi.fn().mockResolvedValue(undefined)
  const app = {
    closeProject,
    fileOperations,
    settings: { actor: { send: clearProjectSettings } },
    registry: {
      optional: (service: unknown) =>
        service === homeProjectActionsService ? actions : undefined,
      get: (valueSpec: unknown) => {
        if (valueSpec === homeProjectEntriesValueSpec) {
          return [homeProject]
        }
        if (valueSpec === appNavigationService) {
          return { dispatch }
        }
        return []
      },
    },
  } as unknown as App
  await expect(
    moveOpenedProjectToCloudLibrary({
      app,
      project,
      title: 'Published example',
    })
  ).resolves.toEqual({
    defaultFile: '/cloud/example/main.kcl',
    projectPath: '/cloud/example',
  })

  expect(closeProject).toHaveBeenCalledOnce()
  expect(clearProjectSettings).toHaveBeenCalledWith({ type: 'clear.project' })
  expect(writeProjectTitleToProjectToml).toHaveBeenCalledWith(
    fileOperations,
    '/projects/example',
    'Published example'
  )
  expect(moveToLibrary).toHaveBeenCalledWith(homeProject, 'personal-cloud')
  expect(dispatch).toHaveBeenCalledOnce()
  expect(dispatch).toHaveBeenCalledWith(openProjectIntent, {
    target: '/cloud/example/main.kcl',
  })
  expect(moveToLibrary).toHaveBeenCalledBefore(dispatch)
})
