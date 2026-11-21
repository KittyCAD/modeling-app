import { createLegacyPublicationWorkflow } from '@src/lib/publishing/legacyWorkflow'
import { createProjectForTest } from '@src/lib/projectTestUtils'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  DIRECTORY_PROJECT_LIBRARY_TYPE,
} from '@src/lib/projectLibraries'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  HomeProjectEntry,
  HomeProjectCloneToLibraryTarget,
} from '@src/registry/contracts/homeProjects'
import type { PublishCurrentProjectArgs } from '@src/lib/publishing/publication'
import { loadWasm } from '@src/unitTestUtils'
import { beforeAll, expect, it, vi } from 'vitest'

let wasm: ModuleType
beforeAll(async () => {
  wasm = await loadWasm()
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
const submission = {
  title: '  Bracket  ',
  description: 'A bracket',
  categoryIds: ['hardware'],
}

function setup(local = false) {
  const path = local ? '/projects/bracket' : '/cloud/bracket'
  const project = Object.freeze(
    createProjectForTest(path, {
      title: 'Original bracket',
      libraryType: local
        ? DIRECTORY_PROJECT_LIBRARY_TYPE
        : CLOUD_PROJECT_LIBRARY_TYPE,
    })
  )
  const entry: HomeProjectEntry = {
    id: 'source',
    name: 'bracket',
    title: 'Original bracket',
    source: 'local',
    status: 'local',
    localProjectPath: path,
    readWriteAccess: true,
  }
  const cloudTarget: HomeProjectCloneToLibraryTarget = {
    library: {
      id: 'cloud',
      title: 'Personal Cloud',
      path: '/cloud',
      type: CLOUD_PROJECT_LIBRARY_TYPE,
    },
    sourceLibrary: {
      id: 'directory',
      title: 'Directory',
      path: '/projects',
      type: DIRECTORY_PROJECT_LIBRARY_TYPE,
    },
  }
  const actions = {
    canRename: () => true,
    rename: vi.fn(async () => {}),
    getCloneToLibraryTargets: () => [cloudTarget],
    cloneToLibrary: vi.fn(async () => ({
      defaultFile: '/cloud/copied/main.kcl',
      localProjectPath: '/cloud/copied',
    })),
  }
  const cloud = {
    idFor: () => 'cloud-copy',
    publishCurrentProject: vi.fn(async (_args: PublishCurrentProjectArgs) => ({
      remoteProjectId: local ? 'cloud-copy' : 'original-cloud',
    })),
    getCurrentProjectPublicationDetails: vi.fn(async () => null),
  }
  const kclManager = {
    wasmInstancePromise: Promise.resolve(wasm),
    path: `${path}/parts/model.kcl`,
    code: 'current buffer',
    writeToFile: vi.fn(async (_code: string) => {}),
  }
  const dependencies = {
    project,
    kclManager,
    cloud,
    actions,
    entries: [entry],
    getEntries: () => [entry],
    token: 'test-token',
    navigate: vi.fn(async () => {}),
    willCloneProjectToCloud: local,
    isCurrent: vi.fn(() => true),
    fileOperations: {
      ...testFileOperations,
      readFile: vi.fn(async (_path: string) =>
        new TextEncoder().encode('cloned contents')
      ),
    },
  }
  return {
    dependencies,
    workflow: createLegacyPublicationWorkflow(dependencies),
  }
}

it('saves and renames the cloud project before submitting its captured file', async () => {
  const { dependencies: d, workflow } = setup()
  await expect(workflow.submit(submission)).resolves.toEqual({
    published: { remoteProjectId: 'original-cloud' },
    details: null,
  })
  expect(d.kclManager.writeToFile).toHaveBeenCalledWith('current buffer')
  expect(d.actions.rename).toHaveBeenCalledWith(d.entries[0], 'Bracket', {
    notify: false,
  })
  expect(d.kclManager.writeToFile).toHaveBeenCalledBefore(d.actions.rename)
  expect(d.actions.rename).toHaveBeenCalledBefore(d.cloud.publishCurrentProject)
  expect(d.cloud.publishCurrentProject).toHaveBeenCalledWith(
    expect.objectContaining({
      project: expect.objectContaining({
        path: '/cloud/bracket',
        title: 'Bracket',
      }),
      currentFilePath: '/cloud/bracket/parts/model.kcl',
      currentFileContents: 'current buffer',
    })
  )
  expect(d.cloud.getCurrentProjectPublicationDetails).toHaveBeenCalledWith(
    expect.objectContaining({
      project: expect.objectContaining({
        path: '/cloud/bracket',
        title: 'Bracket',
      }),
      remoteProjectId: 'original-cloud',
    })
  )
  expect(d.actions.cloneToLibrary).not.toHaveBeenCalled()
  expect(d.project.title).toBe('Original bracket')
})

it('publishes and refreshes the cloud copy without changing the directory source', async () => {
  const { dependencies: d, workflow } = setup(true)
  await expect(workflow.submit(submission)).resolves.toEqual({
    published: { remoteProjectId: 'cloud-copy' },
    details: null,
  })
  expect(d.actions.cloneToLibrary).toHaveBeenCalledWith(d.entries[0], 'cloud', {
    title: 'Bracket',
  })
  expect(d.fileOperations.readFile).toHaveBeenCalledWith(
    '/cloud/copied/parts/model.kcl'
  )
  expect(d.cloud.publishCurrentProject).toHaveBeenCalledWith(
    expect.objectContaining({
      project: expect.objectContaining({
        path: '/cloud/copied',
        libraryType: CLOUD_PROJECT_LIBRARY_TYPE,
        title: 'Bracket',
      }),
      currentFilePath: '/cloud/copied/parts/model.kcl',
      currentFileContents: 'cloned contents',
      remoteProjectId: 'cloud-copy',
    })
  )
  expect(d.cloud.getCurrentProjectPublicationDetails).toHaveBeenCalledWith(
    expect.objectContaining({
      project: expect.objectContaining({ path: '/cloud/copied' }),
      remoteProjectId: 'cloud-copy',
    })
  )
  expect(d.actions.rename).not.toHaveBeenCalled()
  expect(d.project.path).toBe('/projects/bracket')
})

it('stops before saving when the source changes while the runtime is loading', async () => {
  const { dependencies: d } = setup()
  const runtime = Promise.withResolvers<ModuleType>()
  d.kclManager.wasmInstancePromise = runtime.promise
  const workflow = createLegacyPublicationWorkflow(d)
  const result = workflow.submit(submission)
  d.isCurrent.mockReturnValue(false)
  d.kclManager.path = '/projects/other/main.kcl'
  runtime.resolve(wasm)
  await expect(result).resolves.toBeInstanceOf(Error)
  expect(d.kclManager.writeToFile).not.toHaveBeenCalled()
  expect(d.cloud.publishCurrentProject).not.toHaveBeenCalled()
  expect(d.actions.rename).not.toHaveBeenCalled()
})

it('does not upload when persisting the title fails', async () => {
  const { dependencies: d, workflow } = setup()
  d.actions.rename.mockRejectedValue(new Error('Permission denied'))
  await expect(workflow.submit(submission)).resolves.toEqual(
    expect.objectContaining({
      message: 'The project title could not be updated.',
    })
  )
  expect(d.cloud.publishCurrentProject).not.toHaveBeenCalled()
})

it('stops before project operations when the source changes during a save', async () => {
  const { dependencies: d, workflow } = setup(true)
  const saved = Promise.withResolvers<undefined>()
  d.kclManager.writeToFile.mockImplementation(() => saved.promise)
  const result = workflow.submit(submission)
  await vi.waitFor(() => expect(d.kclManager.writeToFile).toHaveBeenCalled())
  d.isCurrent.mockReturnValue(false)
  saved.resolve(undefined)
  await expect(result).resolves.toBeInstanceOf(Error)
  expect(d.actions.cloneToLibrary).not.toHaveBeenCalled()
  expect(d.actions.rename).not.toHaveBeenCalled()
  expect(d.cloud.publishCurrentProject).not.toHaveBeenCalled()
})

it('keeps navigation in the new project while completing a captured cloud copy', async () => {
  const { dependencies: d, workflow } = setup(true)
  const copy = Promise.withResolvers<{
    defaultFile: string
    localProjectPath: string
  }>()
  d.actions.cloneToLibrary.mockImplementation(() => copy.promise)
  const result = workflow.submit(submission)
  await vi.waitFor(() => expect(d.actions.cloneToLibrary).toHaveBeenCalled())
  d.isCurrent.mockReturnValue(false)
  copy.resolve({
    defaultFile: '/cloud/copied/main.kcl',
    localProjectPath: '/cloud/copied',
  })
  await expect(result).resolves.toEqual({
    published: { remoteProjectId: 'cloud-copy' },
    details: null,
  })
  expect(d.navigate).not.toHaveBeenCalled()
  expect(d.cloud.publishCurrentProject).toHaveBeenCalledWith(
    expect.objectContaining({
      project: expect.objectContaining({ path: '/cloud/copied' }),
    })
  )
})
