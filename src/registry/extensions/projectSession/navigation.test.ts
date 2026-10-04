import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { createAppNavigationService } from '@src/lib/appNavigation'
import type { Project } from '@src/lib/project'
import {
  type ProjectNavigationDependencies,
  type ProjectOpenResolverDependencies,
  createOpenProjectIntentContribution,
  resolveProjectOpenRequest,
} from '@src/registry/extensions/projectSession/navigation'
import { openProjectIntent } from '@src/registry/contracts/projectSession'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

const project: Project = {
  name: 'proj',
  path: '/library/proj',
  children: [],
  kcl_file_count: 1,
  directory_count: 0,
  metadata: null,
  default_file: '/library/proj/main.kcl',
  readWriteAccess: true,
}

function resolverHarness(
  overrides: Partial<ProjectOpenResolverDependencies> = {}
) {
  const dependencies: ProjectOpenResolverDependencies = {
    wasmInstancePromise: Promise.resolve({} as ModuleType),
    loadSettings: vi.fn(async () => ({
      settings: { app: {} },
      configuration: {},
    })),
    getCurrentProjectPath: () => undefined,
    getProjectLibraryOwnership: vi.fn(async () => undefined),
    getProjectInfo: vi.fn(async () => project),
    stat: vi.fn(async () => ({}) as never),
    isPathNotFoundError: (error) =>
      error instanceof Error && error.message === 'ENOENT',
    setProjectDirectory: vi.fn(),
    ...overrides,
  }

  return dependencies
}

const throwIfSuperseded = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveProjectOpenRequest', () => {
  test('resolves a project target to its default file and canonical target', async () => {
    const dependencies = resolverHarness()

    const result = await resolveProjectOpenRequest(
      dependencies,
      {
        target: '/library/proj',
        startup: { search: '?pool=alpha', hash: '' },
      },
      throwIfSuperseded
    )

    expect(result).toMatchObject({
      kind: 'resolved',
      file: {
        name: 'main.kcl',
        path: '/library/proj/main.kcl',
      },
      canonicalTarget: '/library/proj/main.kcl',
    })
    expect(dependencies.setProjectDirectory).toHaveBeenCalledWith(
      '/library/proj'
    )
  })

  test('resolves a missing file to the default and preserves URL state', async () => {
    const dependencies = resolverHarness({
      stat: vi.fn(() => Promise.reject(new Error('ENOENT'))),
    })

    const result = await resolveProjectOpenRequest(
      dependencies,
      {
        target: '/library/proj/nope.kcl',
        startup: { search: '?pool=alpha', hash: '' },
      },
      throwIfSuperseded
    )

    expect(result).toMatchObject({
      kind: 'resolved',
      file: {
        name: 'main.kcl',
        path: '/library/proj/main.kcl',
      },
      canonicalTarget: '/library/proj/main.kcl',
    })
  })

  test('does not canonicalize a project settings URL', async () => {
    const dependencies = resolverHarness()

    const result = await resolveProjectOpenRequest(
      dependencies,
      {
        target: '/library/proj',
        startup: {
          additionalIntents: [
            {
              intent: { id: 'settings.open', placement: 'additional' },
              input: { tab: 'project' },
            },
          ],
          search: '',
          hash: '',
        },
      },
      throwIfSuperseded
    )

    expect(result).toMatchObject({
      kind: 'resolved',
      projectPath: '/library/proj',
      canonicalTarget: '/library/proj',
    })
  })

  test('resolves a warm project open to its default file', async () => {
    const dependencies = resolverHarness()

    const result = await resolveProjectOpenRequest(
      dependencies,
      { target: '/library/proj' },
      throwIfSuperseded
    )

    expect(result).toMatchObject({
      kind: 'resolved',
      file: { path: '/library/proj/main.kcl', name: 'main.kcl' },
      canonicalTarget: '/library/proj/main.kcl',
    })
    expect(dependencies.setProjectDirectory).toHaveBeenCalledWith(
      '/library/proj'
    )
  })

  test('resolves a named file without replacing it with the default', async () => {
    const dependencies = resolverHarness()

    const result = await resolveProjectOpenRequest(
      dependencies,
      { target: '/library/proj/part.kcl' },
      throwIfSuperseded
    )

    expect(result).toMatchObject({
      kind: 'resolved',
      file: { path: '/library/proj/part.kcl', name: 'part.kcl' },
      canonicalTarget: '/library/proj/part.kcl',
    })
  })
})

const resolvedProject = {
  kind: 'resolved' as const,
  projectName: 'bracket',
  projectPath: '/projects/bracket',
  initialEditorPath: '/projects/bracket/main.kcl',
  project: {
    ...project,
    name: 'bracket',
    path: '/projects/bracket',
    default_file: '/projects/bracket/main.kcl',
  },
  file: { name: 'main.kcl', path: '/projects/bracket/main.kcl' },
  canonicalTarget: '/projects/bracket/main.kcl',
}

function navigationHarness(
  overrides: Partial<ProjectNavigationDependencies> = {}
) {
  const dependencies: ProjectNavigationDependencies = {
    resolveProjectOpen: vi.fn(async () => resolvedProject),
    openResolvedProject: vi.fn<
      ProjectNavigationDependencies['openResolvedProject']
    >(async (resolution) => ({
      kind: 'opened',
      data: {
        code: 'x = 1',
        project: resolution.project,
        file: { ...resolution.file, children: [] },
      },
    })),
    projectOpened: vi.fn(),
    ...overrides,
  }

  const projectOpen = createOpenProjectIntentContribution(dependencies)
  return {
    dependencies,
    projectOpen,
    navigation: createAppNavigationService([projectOpen.contribution]),
  }
}

describe('project.open navigation contribution', () => {
  test('opens a project before projecting its location', async () => {
    const { dependencies, navigation } = navigationHarness()
    const request = { target: '/projects/bracket' }

    await expect(
      navigation.dispatch(openProjectIntent, { target: '/projects/bracket' })
    ).resolves.toMatchObject({ kind: 'opened' })
    expect(dependencies.openResolvedProject).toHaveBeenCalledWith(
      resolvedProject,
      expect.any(Function)
    )
    expect(dependencies.projectOpened).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'opened' }),
      resolvedProject,
      request
    )
    expect(dependencies.openResolvedProject).toHaveBeenCalledBefore(
      vi.mocked(dependencies.projectOpened)
    )
  })

  test('a newer project open aborts the in-flight open', async () => {
    let finishResolution: () => void = () => undefined
    const resolutionStarted = new Promise<void>((resolve) => {
      finishResolution = resolve
    })
    const { navigation } = navigationHarness({
      resolveProjectOpen: vi
        .fn<ProjectNavigationDependencies['resolveProjectOpen']>()
        .mockImplementationOnce(async () => {
          await resolutionStarted
          return resolvedProject
        })
        .mockResolvedValueOnce(resolvedProject),
    })

    const firstOpen = navigation.dispatch(openProjectIntent, {
      target: '/projects/bracket',
    })
    await expect(
      navigation.dispatch(openProjectIntent, { target: '/projects/gear' })
    ).resolves.toMatchObject({ kind: 'opened' })
    finishResolution()

    await expect(firstOpen).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('allows another primary intent to cancel an in-flight project open', async () => {
    const disposeIfUnused = vi.fn(async () => undefined)
    let finishResolution: () => void = () => undefined
    const resolutionStarted = new Promise<void>((resolve) => {
      finishResolution = resolve
    })
    const { navigation, projectOpen } = navigationHarness({
      resolveProjectOpen: vi.fn(async () => {
        await resolutionStarted
        return { ...resolvedProject, disposeIfUnused }
      }),
    })

    const firstOpen = navigation.dispatch(openProjectIntent, {
      target: '/projects/bracket',
    })
    projectOpen.cancelProjectOpen()
    finishResolution()

    await expect(firstOpen).rejects.toMatchObject({ name: 'AbortError' })
    expect(disposeIfUnused).toHaveBeenCalledOnce()
  })
})
