import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
} from '@src/lib/projectLibraries'
import {
  cloneOpenedProjectToCloudLibrary,
  updateProjectTitleForPublication,
} from '@src/lib/cloudProjects/cloneOpenedProjectToCloudLibrary'
import type {
  HomeProjectEntry,
  HomeProjectCloneToLibraryTarget,
} from '@src/registry/contracts/homeProjects'
import { expect, test, vi } from 'vitest'

const source: HomeProjectEntry = Object.freeze({
  id: 'local:example',
  source: 'local',
  status: 'local',
  name: 'example',
  title: 'Original example',
  localProjectPath: '/projects/example',
  readWriteAccess: true,
})
const cloudTarget: HomeProjectCloneToLibraryTarget = {
  library: {
    id: 'personal-cloud',
    title: 'Personal Cloud',
    path: '/cloud',
    type: CLOUD_PROJECT_LIBRARY_TYPE,
  },
  sourceLibrary: {
    id: 'directory',
    title: 'Local projects',
    path: '/projects',
    type: DIRECTORY_PROJECT_LIBRARY_TYPE,
  },
}

function setup() {
  return {
    actions: {
      getCloneToLibraryTargets: () => [cloudTarget],
      cloneToLibrary: vi.fn(async () => ({
        defaultFile: '/cloud/example/main.kcl',
        localProjectPath: '/cloud/example',
      })),
      canRename: () => true,
      rename: vi.fn(async () => {}),
    },
    entries: [source],
    projectPath: '/projects/example',
    title: 'Published example',
    navigate: vi.fn(async () => {}),
  }
}

test('clones and opens a cloud copy without retitling the source', async () => {
  const dependencies = setup()
  await expect(cloneOpenedProjectToCloudLibrary(dependencies)).resolves.toEqual(
    {
      defaultFile: '/cloud/example/main.kcl',
      projectPath: '/cloud/example',
    }
  )
  expect(dependencies.actions.cloneToLibrary).toHaveBeenCalledWith(
    source,
    'personal-cloud',
    { title: 'Published example' }
  )
  expect(dependencies.actions.rename).not.toHaveBeenCalled()
  expect(source.title).toBe('Original example')
  expect(dependencies.navigate).toHaveBeenCalledWith(
    '/file/%2Fcloud%2Fexample%2Fmain.kcl'
  )
  expect(dependencies.actions.cloneToLibrary).toHaveBeenCalledBefore(
    dependencies.navigate
  )
})

test('keeps the source open when cloning fails', async () => {
  const dependencies = setup()
  const failure = new Error('Upload failed')
  dependencies.actions.cloneToLibrary.mockRejectedValue(failure)
  await expect(cloneOpenedProjectToCloudLibrary(dependencies)).resolves.toBe(
    failure
  )
  expect(dependencies.navigate).not.toHaveBeenCalled()
  expect(dependencies.actions.rename).not.toHaveBeenCalled()
})

test('updates only the open project title before publication', async () => {
  const dependencies = setup()
  dependencies.entries.unshift({
    ...source,
    id: 'other',
    localProjectPath: '/projects/other',
  })
  await expect(updateProjectTitleForPublication(dependencies)).resolves.toBe(
    true
  )
  expect(dependencies.actions.rename).toHaveBeenCalledExactlyOnceWith(
    source,
    'Published example',
    { notify: false }
  )
})

test('does not rename a project whose publication title is already saved', async () => {
  const dependencies = { ...setup(), title: 'Original example' }
  await expect(updateProjectTitleForPublication(dependencies)).resolves.toBe(
    true
  )
  expect(dependencies.actions.rename).not.toHaveBeenCalled()
})

test('reports an unavailable rename rather than publishing with an unsaved title', async () => {
  const dependencies = setup()
  dependencies.actions.canRename = () => false
  await expect(
    updateProjectTitleForPublication(dependencies)
  ).resolves.toBeInstanceOf(Error)
  expect(dependencies.actions.rename).not.toHaveBeenCalled()
})
