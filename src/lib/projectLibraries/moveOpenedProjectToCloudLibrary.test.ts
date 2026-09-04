import type { App } from '@src/lib/app'
import type { Project } from '@src/lib/project'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
} from '@src/lib/projectLibraries'
import { moveOpenedProjectToCloudLibrary } from '@src/lib/projectLibraries/moveOpenedProjectToCloudLibrary'
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

test('moves an open directory project before opening its new file', async () => {
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
  const openFile = vi.fn().mockResolvedValue({ kind: 'opened' })
  const app = {
    closeProject,
    openFile,
    settings: { actor: { send: clearProjectSettings } },
    registry: {
      optional: (service: unknown) =>
        service === homeProjectActionsService ? actions : undefined,
      get: (valueSpec: unknown) =>
        valueSpec === homeProjectEntriesValueSpec ? [homeProject] : [],
    },
  } as unknown as App
  const navigate = vi.fn().mockResolvedValue(undefined)

  await expect(
    moveOpenedProjectToCloudLibrary({
      app,
      project,
      navigate,
      title: 'Published example',
    })
  ).resolves.toEqual({
    defaultFile: '/cloud/example/main.kcl',
    projectPath: '/cloud/example',
  })

  expect(closeProject).toHaveBeenCalledOnce()
  expect(clearProjectSettings).toHaveBeenCalledWith({ type: 'clear.project' })
  expect(writeProjectTitleToProjectToml).toHaveBeenCalledWith(
    '/projects/example',
    'Published example'
  )
  expect(moveToLibrary).toHaveBeenCalledWith(homeProject, 'personal-cloud')
  // Opening the moved file is an application command now, not a URL
  // navigation. The URL still ends up at that file — it is derived from the
  // project this opens — but nothing here spells it out as a path.
  expect(openFile).toHaveBeenCalledOnce()
  expect(openFile).toHaveBeenCalledWith({ id: '/cloud/example/main.kcl' })
  expect(moveToLibrary).toHaveBeenCalledBefore(openFile)
  // `navigate` survives for the failure branch, which still sends you home.
  expect(navigate).not.toHaveBeenCalled()
})
