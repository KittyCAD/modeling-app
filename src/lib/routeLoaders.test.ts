import { App } from '@src/lib/app'
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
    registry = { get: vi.fn() }
    settings = { actor: {} }
    singletons = { kclManager: { wasmInstancePromise: Promise.resolve({}) } }
  },
}))

vi.mock('@src/lib/settings/settingsUtils', () => ({
  loadAndValidateSettings: vi.fn(() =>
    Promise.reject(new Error('Unexpected project lookup for a legacy bookmark'))
  ),
}))

vi.mock('@src/lib/cloudProjectOpen', async (importOriginal) => ({
  ...(await importOriginal<typeof CloudProjectOpen>()),
  resolveCloudProjectSource: vi.fn(),
  downloadCloudProjectView: vi.fn(),
}))
vi.mock('@src/lib/fs-zds', async (importOriginal) => ({
  ...(await importOriginal<typeof FileSystem>()),
  createReadOnlyProjectSnapshot: vi.fn(),
  disposeReadOnlyProjectSnapshot: vi.fn(),
}))

describe('fileLoader legacy web bookmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

describe('cloudProjectLoader', () => {
  it('disposes a snapshot when navigation is canceled during materialization', async () => {
    const actor = createActor(
      createMachine({
        initial: 'loggedIn',
        states: { loggedIn: {}, loggedOut: {} },
      })
    ).start()
    const controller = new AbortController()
    const app = Object.assign(new App(App.getDefaultSystems()), {
      auth: { actor, token: { value: 'test' } },
      wasmPromise: Promise.resolve({}),
      beginFileRouteLoad: vi.fn(() => () => controller.signal.throwIfAborted()),
    })
    const request = new Request(
      'https://app.zoo.dev/project/project?file=parts%2Fmain.kcl',
      { signal: controller.signal }
    )
    vi.mocked(loadAndValidateSettings).mockResolvedValueOnce({
      settings: { app: {} },
    } as Awaited<ReturnType<typeof loadAndValidateSettings>>)
    vi.mocked(resolveCloudProjectSource).mockResolvedValueOnce({
      source: { id: 'project', canEdit: false, kind: 'public' },
      title: 'Public project',
    })
    vi.mocked(downloadCloudProjectView).mockResolvedValueOnce({
      files: [],
      entrypoint: 'main.kcl',
    })
    vi.mocked(createReadOnlyProjectSnapshot).mockImplementationOnce(
      async () => {
        controller.abort()
        return '/cache/views/unused'
      }
    )
    const load = cloudProjectLoader({ app })({
      request,
      params: { id: 'project' },
      context: undefined,
      unstable_pattern: '/project/:id',
    })
    await expect(load).rejects.toMatchObject({ name: 'AbortError' })
    expect(disposeReadOnlyProjectSnapshot).toHaveBeenCalledWith(
      '/cache/views/unused'
    )
    actor.stop()
  })
})
