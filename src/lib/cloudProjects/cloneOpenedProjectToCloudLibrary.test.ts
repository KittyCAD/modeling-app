import type { App } from '@src/lib/app'
import type { Project } from '@src/lib/project'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
} from '@src/lib/projectLibraries'
import { cloneOpenedProjectToCloudLibrary } from '@src/lib/cloudProjects/cloneOpenedProjectToCloudLibrary'
import type {
  HomeProjectActionsService,
  HomeProjectEntry,
  HomeProjectCloneToLibraryTarget,
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

test('clones an open directory project without closing or retitling the source', async () => {
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
  } as HomeProjectCloneToLibraryTarget
  const cloneToLibrary = vi.fn().mockResolvedValue({
    defaultFile: '/cloud/example/main.kcl',
    localProjectPath: '/cloud/example',
  })
  const actions = {
    getCloneToLibraryTargets: vi.fn().mockReturnValue([cloudLibraryTarget]),
    cloneToLibrary,
  } as unknown as HomeProjectActionsService
  const closeProject = vi.fn()
  const clearProjectSettings = vi.fn()
  const fileOperations = {} as App['fileOperations']
  const app = {
    closeProject,
    fileOperations,
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
    cloneOpenedProjectToCloudLibrary({
      app,
      project,
      navigate,
      title: 'Published example',
    })
  ).resolves.toEqual({
    defaultFile: '/cloud/example/main.kcl',
    projectPath: '/cloud/example',
  })

  expect(closeProject).not.toHaveBeenCalled()
  expect(clearProjectSettings).not.toHaveBeenCalled()
  expect(writeProjectTitleToProjectToml).not.toHaveBeenCalled()
  expect(cloneToLibrary).toHaveBeenCalledWith(homeProject, 'personal-cloud', {
    title: 'Published example',
  })
  expect(navigate).toHaveBeenCalledOnce()
  expect(navigate).toHaveBeenCalledWith('/file/%2Fcloud%2Fexample%2Fmain.kcl')
  expect(cloneToLibrary).toHaveBeenCalledBefore(navigate)
})
