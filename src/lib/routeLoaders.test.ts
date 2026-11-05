import { App } from '@src/lib/app'
import { PATHS } from '@src/lib/paths'
import {
  fileLoader,
  projectLoader,
  parseProjectLoaderId,
} from '@src/lib/routeLoaders'
import type * as RouteUtils from '@src/routes/utils'
import { readProject } from '@src/lib/readProject'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const environment = vi.hoisted(() => ({ projectRouteEnabled: true }))
vi.mock('@src/routes/utils', async (importOriginal) => {
  const original = await importOriginal<typeof RouteUtils>()
  return {
    ...original,
    get IS_STAGING_OR_DEBUG() {
      return environment.projectRouteEnabled
    },
  }
})

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
    settings = {
      actor: {},
      get: () => ({ app: { libraries: { current: [] } } }),
    }
    closeProject = vi.fn()
    singletons = { kclManager: { wasmInstancePromise: Promise.resolve({}) } }
  },
}))

vi.mock('@src/lib/settings/settingsUtils', () => ({
  loadAndValidateSettings: vi.fn(() =>
    Promise.reject(new Error('Unexpected project lookup for a legacy bookmark'))
  ),
}))
vi.mock('@src/lib/readProject', () => ({ readProject: vi.fn() }))

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

describe('project loader IDs', () => {
  it('parses cloud project IDs', () => {
    expect(parseProjectLoaderId('cloud:remote-123')).toEqual({
      type: 'cloud',
      projectId: 'remote-123',
    })
  })

  it.each(['/Users/example/project', 'C:\\Users\\example\\project'])(
    'treats filesystem path %s as a path ID',
    (path) => {
      expect(parseProjectLoaderId(path)).toEqual({ type: 'path', path })
    }
  )

  it('does not classify an empty cloud ID as a project ID', () => {
    expect(parseProjectLoaderId('cloud:')).toEqual({
      type: 'path',
      path: 'cloud:',
    })
  })
})

describe('project loader', () => {
  beforeEach(() => vi.clearAllMocks())

  function setup() {
    const app = new App(App.getDefaultSystems())
    const owner = {}
    const openProject = vi.fn(() => owner)
    vi.spyOn(app.registry, 'get')
      .mockReturnValueOnce({})
      .mockReturnValueOnce({ openProject })
    const data = {
      contents: { name: 'empty', path: '/projects/empty', children: [] },
      metadata: { title: 'Empty', readWriteAccess: false },
    }
    const closeProject = vi.spyOn(app, 'closeProject')
    return { app, openProject, closeProject, data, owner }
  }

  it('redirects production requests before accessing storage or session state', async () => {
    const app = new App(App.getDefaultSystems())
    environment.projectRouteEnabled = false
    try {
      const result = await projectLoader({ app })({
        request: new Request('https://app.zoo.dev/project/test'),
        params: { id: '/projects/test' },
        context: undefined,
        unstable_pattern: '/project/:id',
      })
      expect(result).toBeInstanceOf(Response)
      if (!(result instanceof Response)) throw new Error('Expected a redirect')
      expect(result.headers.get('Location')).toBe(PATHS.HOME)
      expect(vi.spyOn(app.registry, 'get')).not.toHaveBeenCalled()
      expect(readProject).not.toHaveBeenCalled()
    } finally {
      environment.projectRouteEnabled = true
    }
  })

  it('publishes project data without settings initialization or an editor', async () => {
    const { app, openProject, closeProject, data, owner } = setup()
    vi.mocked(readProject).mockResolvedValueOnce(data)
    const request = new Request('https://app.zoo.dev/project/test')
    const result = await projectLoader({ app })({
      request,
      params: { id: data.contents.path },
      context: undefined,
      unstable_pattern: '/project/:id',
    })
    expect(result).toBe(owner)
    expect(openProject).toHaveBeenCalledExactlyOnceWith(data)
    expect(closeProject).not.toHaveBeenCalled()
    expect(vi.spyOn(app, 'beginFileRouteLoad')).not.toHaveBeenCalled()
    expect(loadAndValidateSettings).not.toHaveBeenCalled()
    expect(readProject).toHaveBeenCalledWith({}, data.contents.path, {
      signal: request.signal,
      library: undefined,
    })
  })

  it('rejects unsupported cloud IDs without reading or selecting a project', async () => {
    const { app, openProject, closeProject } = setup()
    await expect(
      projectLoader({ app })({
        request: new Request('https://app.zoo.dev/project/cloud'),
        params: { id: 'cloud:remote-123' },
        context: undefined,
        unstable_pattern: '/project/:id',
      })
    ).rejects.toThrow('Cloud project IDs not yet handled')
    expect(readProject).not.toHaveBeenCalled()
    expect(openProject).not.toHaveBeenCalled()
    expect(closeProject).not.toHaveBeenCalled()
  })

  it('retains the active project when reading the next one fails', async () => {
    const { app, openProject, closeProject, data } = setup()
    const failure = new Error('Invalid project.toml')
    vi.mocked(readProject).mockRejectedValueOnce(failure)
    await expect(
      projectLoader({ app })({
        request: new Request('https://app.zoo.dev/project/test'),
        params: { id: data.contents.path },
        context: undefined,
        unstable_pattern: '/project/:id',
      })
    ).rejects.toBe(failure)
    expect(openProject).not.toHaveBeenCalled()
    expect(closeProject).not.toHaveBeenCalled()
  })

  it('rejects a superseded load before replacing the active project', async () => {
    const { app, openProject, closeProject, data } = setup()
    const controller = new AbortController()
    vi.mocked(readProject).mockImplementationOnce(async () => {
      controller.abort()
      return data
    })
    await expect(
      projectLoader({ app })({
        request: new Request('https://app.zoo.dev/project/test', {
          signal: controller.signal,
        }),
        params: { id: data.contents.path },
        context: undefined,
        unstable_pattern: '/project/:id',
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(openProject).not.toHaveBeenCalled()
    expect(closeProject).not.toHaveBeenCalled()
  })
})
