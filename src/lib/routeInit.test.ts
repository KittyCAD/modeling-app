import type { App } from '@src/lib/app'
import type * as PathsModule from '@src/lib/paths'
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
  stat: vi.fn(),
  parseProjectRoute: vi.fn(),
  getProjectLibraryOwnership: vi.fn(async () => undefined),
  loadAndValidateSettings: vi.fn(),
}))

vi.mock('@src/lib/routeLoaderUtils', () => ({
  webHomeRouteEnabled: mocks.webHomeRouteEnabled,
  loadHomeProjects: mocks.loadHomeProjects,
}))

vi.mock('@src/lib/desktop', () => ({
  getProjectInfo: mocks.getProjectInfo,
  getInitialDefaultDir: mocks.getInitialDefaultDir,
}))

vi.mock('@src/lang/project', () => ({
  projectSkeletonCreate: mocks.projectSkeletonCreate,
}))

vi.mock('@src/lang/std/fileSystemManager', () => ({
  projectFsManager: { dir: '' },
}))

vi.mock('@src/lib/projectLibraryOwnership', () => ({
  getProjectLibraryOwnership: mocks.getProjectLibraryOwnership,
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

vi.mock('@src/lib/paths', async () => {
  const actual = await vi.importActual<typeof PathsModule>('@src/lib/paths')
  return { ...actual, parseProjectRoute: mocks.parseProjectRoute }
})

const originalElectron = window.electron

function fakeApp(): App {
  return {
    registry: { get: () => [] },
    singletons: { kclManager: { wasmInstancePromise: Promise.resolve({}) } },
    settings: { actor: { getSnapshot: () => ({ matches: () => true }) } },
    project: undefined,
  } as unknown as App
}

function setDesktop(isDesktop: boolean) {
  window.electron = isDesktop ? ({ process: { env: {} } } as never) : undefined
}

beforeEach(() => {
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

  test('flagged web goes home, carrying the query string', async () => {
    setDesktop(false)
    mocks.webHomeRouteEnabled.mockResolvedValue(true)
    const result = await initIndexRoute(fakeApp(), {
      requestUrl: 'http://localhost/?pool=alpha',
    })
    expect(result).toEqual({ kind: 'redirect', to: `${PATHS.HOME}?pool=alpha` })
  })

  test('unflagged web opens the existing default project file', async () => {
    setDesktop(false)
    mocks.getProjectInfo.mockResolvedValue({
      default_file: '/library/demo-project/main.kcl',
    })
    mocks.stat.mockResolvedValue({})

    const result = await initIndexRoute(fakeApp(), {
      requestUrl: 'http://localhost/',
    })

    expect(result).toEqual({
      kind: 'redirect',
      to: `${PATHS.FILE}/${encodeURIComponent('/library/demo-project/main.kcl')}`,
    })
    expect(mocks.projectSkeletonCreate).not.toHaveBeenCalled()
  })

  test('unflagged web creates a project skeleton when none exists', async () => {
    setDesktop(false)
    mocks.getProjectInfo.mockRejectedValue(new Error('no project'))
    mocks.stat.mockRejectedValue(new Error('ENOENT'))

    const result = await initIndexRoute(fakeApp(), {
      requestUrl: 'http://localhost/',
    })

    expect(mocks.projectSkeletonCreate).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      kind: 'redirect',
      to: `${PATHS.FILE}/${encodeURIComponent('/library/demo-project/main.kcl')}`,
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
    expect(result).toEqual({ kind: 'redirect', to: PATHS.HOME })
  })

  test('a project root redirects to its default file, preserving the rest of the URL', async () => {
    setDesktop(false)
    mocks.parseProjectRoute.mockReturnValue({
      projectName: 'proj',
      projectPath: '/library/proj',
      currentFileName: undefined,
      currentFilePath: undefined,
    })
    mocks.getProjectInfo.mockResolvedValue({
      default_file: '/library/proj/main.kcl',
    })

    const result = await initFileRoute(fakeApp(), {
      id: '/library/proj',
      requestUrl: `http://localhost${PATHS.FILE}/%2Flibrary%2Fproj?pool=alpha`,
    })

    // The redirect is a substitution on the whole request URL rather than a
    // rebuilt path, so the origin and query string survive untouched. This is
    // the redirect most at risk of drifting when the URL is derived instead.
    expect(result).toEqual({
      kind: 'redirect',
      to: `http://localhost${PATHS.FILE}/%2Flibrary%2Fproj%2Fmain.kcl?pool=alpha`,
    })
  })

  test('a /settings URL never redirects to the default file', async () => {
    setDesktop(false)
    mocks.parseProjectRoute.mockReturnValue({
      projectName: 'proj',
      projectPath: '/library/proj',
      currentFileName: undefined,
      currentFilePath: undefined,
    })

    // The `/settings` guard skips default-file resolution entirely, so the
    // shape that would otherwise redirect falls through to opening the project
    // instead. Settings is reachable on a project root, not just on a file.
    const result = await initFileRoute(fakeApp(), {
      id: '/library/proj',
      requestUrl: `http://localhost${PATHS.FILE}/%2Flibrary%2Fproj/settings`,
    }).catch((error: Error) => error)

    expect(result).not.toMatchObject({ kind: 'redirect' })
  })

  test('an unresolvable route throws, so the router error element still shows', async () => {
    setDesktop(false)
    mocks.parseProjectRoute.mockReturnValue(undefined)

    await expect(
      initFileRoute(fakeApp(), {
        id: '/library/proj/main.kcl',
        requestUrl: 'http://localhost/file/x',
      })
    ).rejects.toThrow('bug: projectPathData undefined')
  })

  test('an unusable file falls back to the project default, carrying the query string', async () => {
    setDesktop(false)
    mocks.parseProjectRoute.mockReturnValue({
      // No project name is one of the four ways this route decides the target
      // is unusable and falls back.
      projectName: undefined,
      projectPath: '/library/proj',
      currentFileName: 'main.kcl',
      currentFilePath: '/library/proj/main.kcl',
    })
    mocks.getProjectInfo.mockResolvedValue({
      default_file: '/library/proj/main.kcl',
    })
    mocks.stat.mockResolvedValue({})

    const result = await initFileRoute(fakeApp(), {
      id: '/library/proj/nope.kcl',
      requestUrl: `http://localhost${PATHS.FILE}/%2Flibrary%2Fproj%2Fnope.kcl?pool=alpha`,
    })

    expect(result).toEqual({
      kind: 'redirect',
      to: `${PATHS.FILE}/${encodeURIComponent('/library/proj/main.kcl')}?pool=alpha`,
    })
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
