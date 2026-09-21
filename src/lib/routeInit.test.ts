import type { App } from '@src/lib/app'
import { PATHS } from '@src/lib/paths'
import {
  initFileRoute,
  initHomeRoute,
  initIndexRoute,
} from '@src/lib/routeInit'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * These pin the typed startup transitions and their canonical paths. The
 * Playwright suite asserts URLs literally, so byte-identical projections are
 * the safety net for this refactor.
 *
 * This logic had no unit coverage at all while it lived inside React Router
 * loaders, because reaching it needed a mounted data router.
 */

const mocks = vi.hoisted(() => ({
  webHomeRouteEnabled: vi.fn<() => Promise<boolean>>(),
  loadHomeProjects: vi.fn(() => ({})),
  getProjectInfo: vi.fn(),
  getInitialDefaultDir: vi.fn(async () => '/library'),
  projectSkeletonCreate: vi.fn(async () => undefined),
  exists: vi.fn(),
  stat: vi.fn(),
  loadAndValidateSettings: vi.fn(),
  supersedeProjectOpen: vi.fn(),
  openProject: vi.fn(),
}))

vi.mock('@src/lib/routeLoaderUtils', () => ({
  webHomeRouteEnabled: mocks.webHomeRouteEnabled,
  loadHomeProjects: mocks.loadHomeProjects,
}))

vi.mock('@src/lib/desktop', () => ({
  getProjectInfo: mocks.getProjectInfo,
  getInitialDefaultDir: mocks.getInitialDefaultDir,
  isPathNotFoundError: (error: unknown) =>
    error instanceof Error && error.message === 'ENOENT',
}))

vi.mock('@src/lang/project', () => ({
  projectSkeletonCreate: mocks.projectSkeletonCreate,
}))

vi.mock('@src/lang/std/fileSystemManager', () => ({
  projectFsManager: { dir: '' },
}))

vi.mock('@src/lib/settings/settingsUtils', () => ({
  loadAndValidateSettings: mocks.loadAndValidateSettings,
}))

vi.mock('@src/lib/fs-zds', () => ({
  default: {
    stat: mocks.stat,
    resolve: (...parts: string[]) => parts.reduce((a, b) => `${a}/${b}`),
  },
}))

const originalElectron = window.electron

function fakeApp(): App {
  return {
    fileOperations: {},
    registry: {
      get: () => ({
        exists: mocks.exists,
        stat: mocks.stat,
        supersedeProjectOpen: mocks.supersedeProjectOpen,
        openProject: mocks.openProject,
      }),
    },
    singletons: { kclManager: { wasmInstancePromise: Promise.resolve({}) } },
    settings: { actor: { getSnapshot: () => ({ matches: () => true }) } },
    project: undefined,
  } as unknown as App
}

function setDesktop(isDesktop: boolean) {
  window.electron = isDesktop ? ({ process: { env: {} } } as never) : undefined
}

beforeEach(() => {
  mocks.exists.mockResolvedValue(true)
  mocks.loadAndValidateSettings.mockResolvedValue({
    settings: {
      app: { projectDirectory: { current: '/library' }, libraries: undefined },
      modeling: { defaultUnit: { current: 'mm' } },
    },
    configuration: {},
  })
  mocks.webHomeRouteEnabled.mockResolvedValue(false)
})

afterEach(() => {
  vi.clearAllMocks()
  window.electron = originalElectron
})

describe('initIndexRoute', () => {
  test('desktop goes home, carrying the query string', async () => {
    setDesktop(true)
    const result = await initIndexRoute(fakeApp(), {
      requestUrl: 'http://localhost/?pool=alpha',
    })
    expect(result).toEqual({
      kind: 'transition',
      destination: { type: 'home' },
      canonicalPath: `${PATHS.HOME}?pool=alpha`,
    })
  })

  test('defers to the open-in-desktop handler rather than continuing', async () => {
    setDesktop(false)
    const result = await initIndexRoute(fakeApp(), {
      requestUrl: 'http://localhost/?ask-open-desktop=true',
    })
    // Finishing here lets OpenInDesktopAppHandler show its modal; continuing
    // to another destination would dead-end that flow.
    expect(result).toEqual({ kind: 'ready', data: undefined })
    expect(mocks.webHomeRouteEnabled).not.toHaveBeenCalled()
  })

  test('flagged web goes home, carrying the query string', async () => {
    setDesktop(false)
    mocks.webHomeRouteEnabled.mockResolvedValue(true)
    const result = await initIndexRoute(fakeApp(), {
      requestUrl: 'http://localhost/?pool=alpha',
    })
    expect(result).toEqual({
      kind: 'transition',
      destination: { type: 'home' },
      canonicalPath: `${PATHS.HOME}?pool=alpha`,
    })
  })

  test('unflagged web opens the existing default project file', async () => {
    setDesktop(false)
    mocks.getProjectInfo.mockResolvedValue({
      default_file: '/library/demo-project/main.kcl',
    })
    mocks.exists.mockResolvedValue(true)

    const result = await initIndexRoute(fakeApp(), {
      requestUrl: 'http://localhost/',
    })

    expect(result).toEqual({
      kind: 'transition',
      destination: {
        type: 'project',
        target: '/library/demo-project/main.kcl',
      },
      canonicalPath: `${PATHS.FILE}/${encodeURIComponent(
        '/library/demo-project/main.kcl'
      )}`,
    })
    expect(mocks.projectSkeletonCreate).not.toHaveBeenCalled()
  })

  test('unflagged web creates a project skeleton when none exists', async () => {
    setDesktop(false)
    mocks.getProjectInfo.mockRejectedValue(new Error('no project'))
    mocks.exists.mockResolvedValue(false)

    const result = await initIndexRoute(fakeApp(), {
      requestUrl: 'http://localhost/',
    })

    expect(mocks.projectSkeletonCreate).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      kind: 'transition',
      destination: {
        type: 'project',
        target: '/library/demo-project/main.kcl',
      },
      canonicalPath: `${PATHS.FILE}/${encodeURIComponent(
        '/library/demo-project/main.kcl'
      )}`,
    })
  })
})

describe('initFileRoute', () => {
  test('sends the legacy /browser id home', async () => {
    setDesktop(false)
    const result = await initFileRoute(fakeApp(), {
      id: '/browser/whatever.kcl',
      requestUrl: 'http://localhost/file/%2Fbrowser%2Fwhatever.kcl',
    })
    // The one genuinely routing-shaped case left here: a legacy URL shape with
    // no meaning as application state, so it never reaches `OpenProject`.
    expect(result).toEqual({
      kind: 'transition',
      destination: { type: 'home' },
      canonicalPath: PATHS.HOME,
    })
    expect(mocks.supersedeProjectOpen).toHaveBeenCalledWith(expect.anything())
    expect(mocks.openProject).not.toHaveBeenCalled()
  })

  test('hands everything else to OpenProject', async () => {
    setDesktop(false)
    const data = { code: 'x = 1' }
    mocks.openProject.mockResolvedValue({
      kind: 'opened',
      data,
    })

    const result = await initFileRoute(fakeApp(), {
      id: '/library/proj',
      requestUrl: 'http://localhost/file/%2Flibrary%2Fproj',
    })

    expect(mocks.openProject).toHaveBeenCalledWith({
      target: '/library/proj',
      requestUrl: 'http://localhost/file/%2Flibrary%2Fproj',
      signal: expect.anything(),
    })
    expect(result).toEqual({ kind: 'ready', data })
  })

  test('passes an opened file back as loader data', async () => {
    setDesktop(false)
    const data = { code: 'x = 1' }
    mocks.openProject.mockResolvedValue({ kind: 'opened', data })

    const result = await initFileRoute(fakeApp(), {
      id: '/library/proj/main.kcl',
      requestUrl: 'http://localhost/file/%2Flibrary%2Fproj%2Fmain.kcl',
    })

    expect(result).toEqual({ kind: 'ready', data })
  })
})

describe('initHomeRoute', () => {
  test('unflagged web continues through the index policy', async () => {
    setDesktop(false)
    mocks.webHomeRouteEnabled.mockResolvedValue(false)
    const result = await initHomeRoute(fakeApp())
    expect(result).toEqual({
      kind: 'transition',
      destination: { type: 'index' },
      canonicalPath: PATHS.INDEX,
    })
    expect(mocks.loadHomeProjects).not.toHaveBeenCalled()
  })

  test('desktop clears the open project and lists folders', async () => {
    setDesktop(true)
    const result = await initHomeRoute(fakeApp())
    expect(result).toEqual({ kind: 'ready', data: {} })
    expect(mocks.loadHomeProjects).toHaveBeenCalledTimes(1)
  })

  test('flagged web lists folders rather than bouncing', async () => {
    setDesktop(false)
    mocks.webHomeRouteEnabled.mockResolvedValue(true)
    const result = await initHomeRoute(fakeApp())
    expect(result).toEqual({ kind: 'ready', data: {} })
    expect(mocks.loadHomeProjects).toHaveBeenCalledTimes(1)
  })
})
