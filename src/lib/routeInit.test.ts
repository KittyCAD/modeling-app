import type { App } from '@src/lib/app'
import { PATHS } from '@src/lib/paths'
import {
  initFileRoute,
  initHomeRoute,
  initIndexRoute,
} from '@src/lib/routeInit'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * These pin the *decisions* the route-init functions make — above all the exact
 * redirect strings, because the Playwright suite asserts URLs literally and
 * byte-identical URLs are what makes it a safety net for this refactor.
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
  openFile: vi.fn(),
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
    beginFileRouteLoad: () => () => undefined,
    fileOperations: {},
    registry: {
      get: () => ({ exists: mocks.exists, stat: mocks.stat }),
    },
    singletons: { kclManager: { wasmInstancePromise: Promise.resolve({}) } },
    settings: { actor: { getSnapshot: () => ({ matches: () => true }) } },
    openFile: mocks.openFile,
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
    expect(result).toEqual({ kind: 'redirect', to: `${PATHS.HOME}?pool=alpha` })
  })

  test('defers to the open-in-desktop handler rather than redirecting', async () => {
    setDesktop(false)
    const result = await initIndexRoute(fakeApp(), {
      requestUrl: 'http://localhost/?ask-open-desktop=true',
    })
    // Returning without a redirect is what lets OpenInDesktopAppHandler show
    // its modal; redirecting here would dead-end that flow.
    expect(result).toEqual({ kind: 'ok', data: undefined })
    expect(mocks.webHomeRouteEnabled).not.toHaveBeenCalled()
  })

  test('web goes home, carrying the query string', async () => {
    setDesktop(false)
    const result = await initIndexRoute(fakeApp(), {
      requestUrl: 'http://localhost/?pool=alpha',
    })
    expect(result).toEqual({ kind: 'redirect', to: `${PATHS.HOME}?pool=alpha` })
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
    // no meaning as application state, so it never reaches `openFile`.
    expect(result).toEqual({ kind: 'redirect', to: PATHS.HOME })
    expect(mocks.openFile).not.toHaveBeenCalled()
  })

  test('hands everything else to app.openFile and passes its redirect through', async () => {
    setDesktop(false)
    mocks.openFile.mockResolvedValue({
      kind: 'redirect',
      to: '/file/elsewhere',
    })

    const result = await initFileRoute(fakeApp(), {
      id: '/library/proj',
      requestUrl: 'http://localhost/file/%2Flibrary%2Fproj',
    })

    expect(mocks.openFile).toHaveBeenCalledWith({
      id: '/library/proj',
      requestUrl: 'http://localhost/file/%2Flibrary%2Fproj',
      signal: expect.anything(),
    })
    expect(result).toEqual({ kind: 'redirect', to: '/file/elsewhere' })
  })

  test('passes an opened file back as loader data', async () => {
    setDesktop(false)
    const data = { code: 'x = 1' }
    mocks.openFile.mockResolvedValue({ kind: 'opened', data })

    const result = await initFileRoute(fakeApp(), {
      id: '/library/proj/main.kcl',
      requestUrl: 'http://localhost/file/%2Flibrary%2Fproj%2Fmain.kcl',
    })

    expect(result).toEqual({ kind: 'ok', data })
  })
})

describe('initHomeRoute', () => {
  test('unflagged web bounces out to the index', async () => {
    setDesktop(false)
    mocks.webHomeRouteEnabled.mockResolvedValue(false)
    const result = await initHomeRoute(fakeApp())
    expect(result).toEqual({ kind: 'redirect', to: PATHS.INDEX })
    expect(mocks.loadHomeProjects).not.toHaveBeenCalled()
  })

  test('desktop clears the open project and lists folders', async () => {
    setDesktop(true)
    const result = await initHomeRoute(fakeApp())
    expect(result).toEqual({ kind: 'ok', data: {} })
    expect(mocks.loadHomeProjects).toHaveBeenCalledTimes(1)
  })

  test('flagged web lists folders rather than bouncing', async () => {
    setDesktop(false)
    mocks.webHomeRouteEnabled.mockResolvedValue(true)
    const result = await initHomeRoute(fakeApp())
    expect(result).toEqual({ kind: 'ok', data: {} })
    expect(mocks.loadHomeProjects).toHaveBeenCalledTimes(1)
  })
})
