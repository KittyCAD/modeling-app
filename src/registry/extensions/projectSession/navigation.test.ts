import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { createAppNavigationService } from '@src/lib/appNavigation'
import { PATHS } from '@src/lib/paths'
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
    isDesktop: () => false,
    ...overrides,
  }

  return dependencies
}

const throwIfSuperseded = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveProjectOpenRequest', () => {
  test('canonicalizes a project URL to its default file', async () => {
    const dependencies = resolverHarness()

    const result = await resolveProjectOpenRequest(
      dependencies,
      {
        target: '/library/proj',
        requestUrl: `http://localhost${PATHS.FILE}/%2Flibrary%2Fproj?pool=alpha`,
      },
      throwIfSuperseded
    )

    expect(result).toEqual({
      kind: 'redirect',
      to: `http://localhost${PATHS.FILE}/%2Flibrary%2Fproj%2Fmain.kcl?pool=alpha`,
    })
    expect(dependencies.setProjectDirectory).not.toHaveBeenCalled()
  })

  test('redirects a missing file while preserving the query string', async () => {
    const dependencies = resolverHarness({
      stat: vi.fn(() => Promise.reject(new Error('ENOENT'))),
    })

    const result = await resolveProjectOpenRequest(
      dependencies,
      {
        target: '/library/proj/nope.kcl',
        requestUrl: `http://localhost${PATHS.FILE}/%2Flibrary%2Fproj%2Fnope.kcl?pool=alpha`,
      },
      throwIfSuperseded
    )

    expect(result).toEqual({
      kind: 'redirect',
      to: `${PATHS.FILE}/${encodeURIComponent('/library/proj/main.kcl')}?pool=alpha`,
    })
  })

  test('does not canonicalize a project settings URL', async () => {
    const dependencies = resolverHarness()

    const result = await resolveProjectOpenRequest(
      dependencies,
      {
        target: '/library/proj',
        requestUrl: `http://localhost${PATHS.FILE}/%2Flibrary%2Fproj/settings`,
      },
      throwIfSuperseded
    )

    expect(result).toMatchObject({
      kind: 'resolved',
      projectPath: '/library/proj',
    })
  })

  test('rejects a missing target for the route error boundary', async () => {
    const dependencies = resolverHarness()

    await expect(
      resolveProjectOpenRequest(
        dependencies,
        { target: undefined, requestUrl: 'http://localhost/file' },
        throwIfSuperseded
      )
    ).rejects.toThrow('bug: projectPathData undefined')
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
    ...overrides,
  }

  const projectOpen = createOpenProjectIntentContribution(dependencies)
  return {
    dependencies,
    navigation: createAppNavigationService([projectOpen.contribution], {
      supersedeProjectOpen: projectOpen.supersedeProjectOpen,
    }),
  }
}

describe('project.open navigation contribution', () => {
  test('returns a canonical redirect without opening a project', async () => {
    const { dependencies, navigation } = navigationHarness({
      resolveProjectOpen: vi.fn<
        ProjectNavigationDependencies['resolveProjectOpen']
      >(async () => ({ kind: 'redirect', to: '/file/canonical' })),
    })

    await expect(
      navigation.dispatch(openProjectIntent, { target: '/projects/bracket' })
    ).resolves.toEqual({ kind: 'redirect', to: '/file/canonical' })
    expect(dependencies.openResolvedProject).not.toHaveBeenCalled()
  })

  test('opens a resolved project through the lifecycle operation', async () => {
    const { dependencies, navigation } = navigationHarness()

    await expect(
      navigation.dispatch(openProjectIntent, { target: '/projects/bracket' })
    ).resolves.toMatchObject({ kind: 'opened' })
    expect(dependencies.openResolvedProject).toHaveBeenCalledWith(
      resolvedProject,
      expect.any(Function)
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

  test('explicit supersession aborts the in-flight project open', async () => {
    let finishResolution: () => void = () => undefined
    const resolutionStarted = new Promise<void>((resolve) => {
      finishResolution = resolve
    })
    const { navigation } = navigationHarness({
      resolveProjectOpen: vi.fn(async () => {
        await resolutionStarted
        return resolvedProject
      }),
    })

    const firstOpen = navigation.dispatch(openProjectIntent, {
      target: '/projects/bracket',
    })
    navigation.supersedeProjectOpen()
    finishResolution()

    await expect(firstOpen).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('a caller abort signal aborts the project open', async () => {
    let finishResolution: () => void = () => undefined
    const resolutionStarted = new Promise<void>((resolve) => {
      finishResolution = resolve
    })
    const { navigation } = navigationHarness({
      resolveProjectOpen: vi.fn(async () => {
        await resolutionStarted
        return resolvedProject
      }),
    })
    const controller = new AbortController()

    const open = navigation.dispatch(openProjectIntent, {
      target: '/projects/bracket',
      signal: controller.signal,
    })
    controller.abort()
    finishResolution()

    await expect(open).rejects.toMatchObject({ name: 'AbortError' })
  })
})
