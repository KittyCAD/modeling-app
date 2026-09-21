import { PATHS } from '@src/lib/paths'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import {
  type ProjectOpenResolverDependencies,
  resolveProjectOpenRequest,
} from '@src/lib/projectOpen'
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
  test('resolves a project URL to its default file and canonical URL', async () => {
    const dependencies = resolverHarness()

    const result = await resolveProjectOpenRequest(
      dependencies,
      {
        target: '/library/proj',
        requestUrl: `http://localhost${PATHS.FILE}/%2Flibrary%2Fproj?pool=alpha`,
      },
      throwIfSuperseded
    )

    expect(result).toMatchObject({
      kind: 'resolved',
      file: {
        name: 'main.kcl',
        path: '/library/proj/main.kcl',
      },
      canonicalUrl: `http://localhost${PATHS.FILE}/%2Flibrary%2Fproj%2Fmain.kcl?pool=alpha`,
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
        requestUrl: `http://localhost${PATHS.FILE}/%2Flibrary%2Fproj%2Fnope.kcl?pool=alpha`,
      },
      throwIfSuperseded
    )

    expect(result).toMatchObject({
      kind: 'resolved',
      file: {
        name: 'main.kcl',
        path: '/library/proj/main.kcl',
      },
      canonicalUrl: `${PATHS.FILE}/${encodeURIComponent(
        '/library/proj/main.kcl'
      )}?pool=alpha`,
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
