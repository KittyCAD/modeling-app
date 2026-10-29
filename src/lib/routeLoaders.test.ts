import { App } from '@src/lib/app'
import type { Project } from '@src/lib/project'
import { PATHS } from '@src/lib/paths'
import { cloudProjectLoader, fileLoader } from '@src/lib/routeLoaders'
import type * as CloudProjectOpen from '@src/lib/cloudProjectOpen'
import type * as FileSystem from '@src/lib/fs-zds'
import {
  downloadCloudProjectView,
  resolveCloudProjectSource,
} from '@src/lib/cloudProjectOpen'
import {
  createReadOnlyProjectSnapshot,
  disposeReadOnlyProjectSnapshot,
} from '@src/lib/fs-zds'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor, createMachine } from 'xstate'

// Transitive loader imports reach this wrapper even though redirects never use
// Wasm. Unit tests run without the generated Wasm JavaScript or binary.
vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

// Keep application bootstrap and Wasm out of this route regression test.
vi.mock('@src/lib/app', () => ({
  App: class {
    static getDefaultSystems() {
      return {}
    }

    beginFileRouteLoad = vi.fn(() => vi.fn())
    registry = { get: vi.fn(() => ({ exists: async () => true })) }
    wasmPromise = Promise.resolve({})
    project = { path: '' }
    openProject = vi.fn(async (project: Project) => {
      const session = {
        path: project.path,
        projectIORefSignal: { value: project },
        openEditor: vi.fn(),
      }
      this.project = session
      return session
    })
    systemIOActor = {
      getSnapshot: () => ({
        context: {
          requestedFileName: {},
          projectDirectoryPath: '/cache/views',
          folders: [],
        },
        matches: () => false,
      }),
      send: vi.fn(),
    }
    settings = { actor: {} }
    singletons = { kclManager: { wasmInstancePromise: Promise.resolve({}) } }
  },
}))

vi.mock('@src/lib/settings/settingsUtils', () => ({
  loadAndValidateSettings: vi.fn(async () => ({ settings: { app: {} } })),
}))
vi.mock('@src/lib/desktop', () => ({
  getProjectInfo: vi.fn(async (_files: unknown, path: string) => ({
    path,
    name: 'view',
    default_file: `${path}/main.kcl`,
    children: [],
    metadata: null,
    kcl_file_count: 1,
    directory_count: 0,
    readWriteAccess: true,
  })),
}))

vi.mock('@src/lib/cloudProjectOpen', async (importOriginal) => ({
  ...(await importOriginal<typeof CloudProjectOpen>()),
  resolveCloudProjectSource: vi.fn(),
  downloadCloudProjectView: vi.fn(),
}))
vi.mock('@src/lib/fs-zds', async (importOriginal) => {
  const original = await importOriginal<typeof FileSystem>()
  const { posix } = await import('node:path')
  return {
    ...original,
    default: {
      ...original.default,
      join: posix.join.bind(posix),
      relative: posix.relative.bind(posix),
      dirname: posix.dirname.bind(posix),
    },
    createReadOnlyProjectSnapshot: vi.fn(),
    disposeReadOnlyProjectSnapshot: vi.fn(),
  }
})

beforeEach(() => vi.clearAllMocks())

describe('fileLoader legacy web bookmarks', () => {
  it.each(['/browser', '/browser/main.kcl', '/browser/old-project/main.kcl'])(
    'redirects the legacy file id %s home before looking up a project',
    async (id) => {
      const app = new App(App.getDefaultSystems())
      const request = new Request(
        `https://app.zoo.dev${PATHS.FILE}/${encodeURIComponent(id)}`
      )

      // React Router decodes the :id segment before calling the loader.
      const result = await fileLoader({ app })({
        request,
        params: { id },
        context: undefined,
        unstable_pattern: `${PATHS.FILE}/:id`,
      })

      expect(result).toBeInstanceOf(Response)
      if (!(result instanceof Response)) {
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw new Error('Expected a redirect response')
      }
      expect(result.status).toBe(302)
      expect(result.headers.get('Location')).toBe(PATHS.HOME)
      expect(loadAndValidateSettings).not.toHaveBeenCalled()
    }
  )
})

function createCloudLoaderApp(signal = new AbortController().signal) {
  const auth = createActor(
    createMachine({
      initial: 'loggedIn',
      states: { loggedIn: {}, loggedOut: {} },
    })
  ).start()
  const settings = createActor(
    createMachine({ initial: 'idle', states: { idle: {} } })
  ).start()
  const app = Object.assign(new App(App.getDefaultSystems()), {
    auth: { actor: auth, token: { value: 'test' } },
    settings: { actor: settings },
    beginFileRouteLoad: vi.fn(() => () => signal.throwIfAborted()),
  })
  vi.mocked(resolveCloudProjectSource).mockResolvedValue({
    source: { id: 'project', canEdit: false, kind: 'public' },
    title: 'Public project',
  })
  vi.mocked(downloadCloudProjectView).mockResolvedValue({
    files: [],
    entrypoint: 'main.kcl',
  })
  vi.mocked(createReadOnlyProjectSnapshot).mockResolvedValue(
    '/cache/views/unused'
  )
  return {
    app,
    dispose: () => {
      auth.stop()
      settings.stop()
    },
  }
}

describe('cloudProjectLoader', () => {
  it('opens packaged desktop URLs without redirecting a valid default-file selector', async () => {
    const { app, dispose } = createCloudLoaderApp()
    try {
      const result = await cloudProjectLoader({ app })({
        request: new Request('file:///project/project?file=main.kcl'),
        params: { id: 'project' },
        context: undefined,
        unstable_pattern: '/project/:id',
      })
      expect(result).toBeUndefined()
      expect(downloadCloudProjectView).toHaveBeenCalledOnce()
    } finally {
      dispose()
    }
  })

  it('disposes a snapshot when navigation is canceled during materialization', async () => {
    const controller = new AbortController()
    const { app, dispose } = createCloudLoaderApp(controller.signal)
    vi.mocked(createReadOnlyProjectSnapshot).mockImplementationOnce(
      async () => {
        controller.abort()
        return '/cache/views/unused'
      }
    )
    try {
      const load = cloudProjectLoader({ app })({
        request: new Request(
          'https://app.zoo.dev/project/project?file=parts%2Fmain.kcl',
          { signal: controller.signal }
        ),
        params: { id: 'project' },
        context: undefined,
        unstable_pattern: '/project/:id',
      })
      await expect(load).rejects.toMatchObject({ name: 'AbortError' })
      expect(disposeReadOnlyProjectSnapshot).toHaveBeenCalledWith(
        '/cache/views/unused'
      )
    } finally {
      dispose()
    }
  })
})
