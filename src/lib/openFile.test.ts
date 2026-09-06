import type { App } from '@src/lib/app'
import { openProjectFile } from '@src/lib/openFile'
import type * as PathsModule from '@src/lib/paths'
import { PATHS } from '@src/lib/paths'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * `openProjectFile` owns resolution as well as opening, so these pin both: the
 * exact redirect strings it produces when given a `requestUrl` (the Playwright
 * suite asserts URLs literally), and the fact that without one it resolves to
 * the project default and just opens it.
 */

const mocks = vi.hoisted(() => ({
  getProjectInfo: vi.fn(),
  stat: vi.fn(),
  parseProjectRoute: vi.fn(),
  getProjectLibraryOwnership: vi.fn(async () => undefined),
  loadRouteSettings: vi.fn(),
  waitFor: vi.fn(async () => undefined),
  openEditor: vi.fn(async () => ({ code: 'x = 1' })),
  send: vi.fn(),
}))

vi.mock('@src/lib/desktop', () => ({ getProjectInfo: mocks.getProjectInfo }))
vi.mock('@src/lib/fs-zds', () => ({
  // `sep` matters: `getStringAfterLastSeparator` splits on it.
  default: { stat: mocks.stat, sep: '/' },
}))
vi.mock('@src/lang/std/fileSystemManager', () => ({
  projectFsManager: { dir: '' },
}))
vi.mock('@src/lib/projectLibraryOwnership', () => ({
  getProjectLibraryOwnership: mocks.getProjectLibraryOwnership,
}))
vi.mock('@src/lib/routeSettings', () => ({
  loadRouteSettings: mocks.loadRouteSettings,
}))
vi.mock('xstate', () => ({ waitFor: mocks.waitFor }))
vi.mock('@src/lib/paths', async () => {
  const actual = await vi.importActual<typeof PathsModule>('@src/lib/paths')
  return { ...actual, parseProjectRoute: mocks.parseProjectRoute }
})

const originalElectron = window.electron

function fakeApp(): App {
  return {
    registry: { get: () => [] },
    singletons: { kclManager: { wasmInstancePromise: Promise.resolve({}) } },
    settings: { actor: { send: mocks.send } },
    project: undefined,
    openProject: async () => ({
      openEditor: mocks.openEditor,
      projectIORefSignal: { value: { libraryPath: '/library' } },
    }),
    systemIOActor: {
      getSnapshot: () => ({
        context: {
          requestedFileName: { project: undefined },
          projectDirectoryPath: '/library',
          folders: [],
        },
        matches: () => false,
      }),
      send: vi.fn(),
    },
  } as unknown as App
}

beforeEach(() => {
  mocks.loadRouteSettings.mockResolvedValue({
    settings: { app: { libraries: undefined } },
    configuration: {},
  })
  window.electron = undefined
})

afterEach(() => {
  vi.clearAllMocks()
  window.electron = originalElectron
})

describe('openProjectFile, asked through a URL', () => {
  test('a project root redirects to its default file, preserving the rest of the URL', async () => {
    mocks.parseProjectRoute.mockReturnValue({
      projectName: 'proj',
      projectPath: '/library/proj',
      currentFileName: undefined,
      currentFilePath: undefined,
    })
    mocks.getProjectInfo.mockResolvedValue({
      default_file: '/library/proj/main.kcl',
    })

    const result = await openProjectFile(fakeApp(), {
      id: '/library/proj',
      requestUrl: `http://localhost${PATHS.FILE}/%2Flibrary%2Fproj?pool=alpha`,
    })

    // A substitution on the whole request URL rather than a rebuilt path, so
    // the origin and query string survive untouched.
    expect(result).toEqual({
      kind: 'redirect',
      to: `http://localhost${PATHS.FILE}/%2Flibrary%2Fproj%2Fmain.kcl?pool=alpha`,
    })
  })

  test('an unusable file falls back to the project default, carrying the query string', async () => {
    mocks.parseProjectRoute.mockReturnValue({
      projectName: undefined,
      projectPath: '/library/proj',
      currentFileName: 'main.kcl',
      currentFilePath: '/library/proj/main.kcl',
    })
    mocks.getProjectInfo.mockResolvedValue({
      default_file: '/library/proj/main.kcl',
    })
    mocks.stat.mockResolvedValue({})

    const result = await openProjectFile(fakeApp(), {
      id: '/library/proj/nope.kcl',
      requestUrl: `http://localhost${PATHS.FILE}/%2Flibrary%2Fproj%2Fnope.kcl?pool=alpha`,
    })

    expect(result).toEqual({
      kind: 'redirect',
      to: `${PATHS.FILE}/${encodeURIComponent('/library/proj/main.kcl')}?pool=alpha`,
    })
  })

  test('a /settings URL never redirects to the default file', async () => {
    mocks.parseProjectRoute.mockReturnValue({
      projectName: 'proj',
      projectPath: '/library/proj',
      currentFileName: undefined,
      currentFilePath: undefined,
    })
    mocks.getProjectInfo.mockResolvedValue({ path: '/library/proj' })

    // Settings is reachable on a project root, so the shape that would
    // otherwise redirect has to fall through and open instead.
    const result = await openProjectFile(fakeApp(), {
      id: '/library/proj',
      requestUrl: `http://localhost${PATHS.FILE}/%2Flibrary%2Fproj/settings`,
    })

    expect(result.kind).toBe('opened')
  })

  test('an unresolvable id rejects, so the router error element still shows', async () => {
    mocks.parseProjectRoute.mockReturnValue(undefined)

    await expect(
      openProjectFile(fakeApp(), {
        id: '/library/proj/main.kcl',
        requestUrl: 'http://localhost/file/x',
      })
    ).rejects.toThrow('bug: projectPathData undefined')
  })
})

describe('openProjectFile, asked directly', () => {
  test('opens the project default rather than returning a redirect', async () => {
    mocks.parseProjectRoute.mockReturnValue({
      projectName: 'proj',
      projectPath: '/library/proj',
      currentFileName: undefined,
      currentFilePath: undefined,
    })
    mocks.getProjectInfo.mockResolvedValue({
      default_file: '/library/proj/main.kcl',
    })

    // With no URL there is nothing to correct, so the case that would have
    // redirected resolves to the default file and opens it. This is what lets
    // callers that are not a route open a file at all.
    const result = await openProjectFile(fakeApp(), { id: '/library/proj' })

    expect(result).toMatchObject({
      kind: 'opened',
      data: { file: { path: '/library/proj/main.kcl', name: 'main.kcl' } },
    })
    expect(mocks.openEditor).toHaveBeenCalledWith(
      '/library/proj/main.kcl',
      expect.anything(),
      undefined
    )
  })

  test('opens a named file without consulting the default', async () => {
    mocks.parseProjectRoute.mockReturnValue({
      projectName: 'proj',
      projectPath: '/library/proj',
      currentFileName: 'part.kcl',
      currentFilePath: '/library/proj/part.kcl',
    })
    mocks.getProjectInfo.mockResolvedValue({
      default_file: '/library/proj/main.kcl',
    })
    mocks.stat.mockResolvedValue({})

    const result = await openProjectFile(fakeApp(), {
      id: '/library/proj/part.kcl',
    })

    expect(result).toMatchObject({ kind: 'opened' })
    expect(mocks.openEditor).toHaveBeenCalledWith(
      '/library/proj/part.kcl',
      expect.anything(),
      undefined
    )
  })
})
