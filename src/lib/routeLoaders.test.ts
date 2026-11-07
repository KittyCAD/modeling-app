import '@src/lib/projectSession/next/testFeature'
import { Registry, defineRegistryItem, provide } from '@kittycad/registry'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import {
  executorCapabilityValueSpec,
  executorViewValueSpec,
  executorsService,
} from '@src/lib/executors/registry/contract'
import projectSessionExtension from '@src/lib/projectSession/registry'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import type { Project } from '@src/lib/projectSession/next/types'
import { App } from '@src/lib/app'
import { PATHS } from '@src/lib/paths'
import { fileLoader, projectLoader, localLoader } from '@src/lib/routeLoaders'
import { readProject } from '@src/lib/projectSession/next/utils'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const environment = vi.hoisted(() => ({ projectRouteEnabled: true }))

// Transitive loader imports reach this wrapper even though redirects never use
// Wasm. Unit tests run without the generated Wasm JavaScript or binary.
vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

// Keep application bootstrap and Wasm out of this route regression test.
vi.mock('@src/lib/app', () => ({
  App: class {
    static getDefaultSystems() {
      return {}
    }

    userFeatures = {
      has: () => environment.projectRouteEnabled,
      actor: {
        getSnapshot: () => ({ matches: () => true, context: {} }),
        subscribe: () => ({ unsubscribe: () => {} }),
      },
    }
    beginFileRouteLoad = vi.fn(() => vi.fn())
    registry = { get: vi.fn(), optional: vi.fn() }
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
vi.mock('@src/lib/projectSession/next/utils', () => ({ readProject: vi.fn() }))

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

describe('local directory loader', () => {
  let registry: Registry
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => registry?.[Symbol.dispose]())

  function setup() {
    const app = new App(App.getDefaultSystems())
    registry = new Registry()
    registry.configure([
      editorsExtension,
      executorsExtension,
      projectSessionExtension,
      defineRegistryItem({
        provides: [
          provide(executorCapabilityValueSpec, {
            id: 'preview',
            matches: '*',
            execute: () => ({}),
          }),
          provide(executorViewValueSpec, {
            id: 'preview.view',
            capabilityId: 'preview',
            matches: '*',
            label: 'Preview',
            Component: () => null,
          }),
        ],
      }),
    ])
    const projectSession = registry.get(projectSessionService)
    const openProject = vi.fn(projectSession.openProject)
    const sessions = { ...projectSession, openProject }
    const operations = {
      readFile: vi.fn(async () => new TextEncoder().encode('file contents')),
    }
    vi.spyOn(app.registry, 'optional').mockReturnValue(sessions)
    vi.spyOn(app.registry, 'get')
      .mockImplementation(registry.get.bind(registry))
      .mockReturnValueOnce(operations)
      .mockReturnValueOnce(sessions)
    const data: Project = {
      contents: { name: 'empty', path: '/projects/empty', children: [] },
      metadata: { title: 'Empty', readWriteAccess: false },
    }
    const closeProject = vi.spyOn(app, 'closeProject')
    return {
      app,
      openProject,
      closeProject,
      data,
      operations,
      sessions,
      editors: registry.get(editorsService),
      executors: registry.get(executorsService),
    }
  }

  it('redirects requests without the project-shell flag before accessing storage or session state', async () => {
    const app = new App(App.getDefaultSystems())
    environment.projectRouteEnabled = false
    try {
      const result = await localLoader({ app })({
        request: new Request('https://app.zoo.dev/local/test'),
        params: { path: '/projects/test' },
        context: undefined,
        unstable_pattern: '/local/:path',
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
    const { app, openProject, closeProject, data, operations } = setup()
    vi.mocked(readProject).mockResolvedValueOnce(data)
    const request = new Request('https://app.zoo.dev/local/test')
    const result = await localLoader({ app })({
      request,
      params: { path: data.contents.path },
      context: undefined,
      unstable_pattern: '/local/:path',
    })
    expect(result).toBe(openProject.mock.results[0].value)
    expect(openProject).toHaveBeenCalledExactlyOnceWith(data)
    expect(closeProject).not.toHaveBeenCalled()
    expect(vi.spyOn(app, 'beginFileRouteLoad')).not.toHaveBeenCalled()
    expect(loadAndValidateSettings).not.toHaveBeenCalled()
    expect(readProject).toHaveBeenCalledWith(operations, data.contents.path, {
      signal: request.signal,
      library: undefined,
    })
  })

  it.each([
    { configured: 'nested/notes.md', expected: 'nested/notes.md' },
    { configured: 'missing.kcl', expected: 'main.kcl' },
    { configured: undefined, expected: 'main.kcl' },
  ])(
    'opens $expected as an editor and executor (configured: $configured)',
    async ({ configured, expected }) => {
      const { app, data, editors, executors, operations } = setup()
      data.metadata.defaultFile = configured
      data.contents.children = [
        {
          name: 'other.kcl',
          path: `${data.contents.path}/other.kcl`,
          children: null,
        },
        {
          name: 'main.kcl',
          path: `${data.contents.path}/main.kcl`,
          children: null,
        },
        {
          name: 'nested',
          path: `${data.contents.path}/nested`,
          children: [
            {
              name: 'notes.md',
              path: `${data.contents.path}/nested/notes.md`,
              children: null,
            },
          ],
        },
      ]
      vi.mocked(readProject).mockResolvedValueOnce(data)
      await localLoader({ app })({
        request: new Request('https://app.zoo.dev/local/test'),
        params: { path: data.contents.path },
        context: undefined,
        unstable_pattern: '/local/:path',
      })
      const editor = editors.editors.peek()[0]
      expect(editors.editors.peek()).toHaveLength(1)
      expect(editor.src.peek()).toBe(`${data.contents.path}/${expected}`)
      expect(editor.view.state.doc.toString()).toBe('file contents')
      expect(operations.readFile).toHaveBeenCalledExactlyOnceWith(
        editor.src.peek()
      )
      expect(executors.viewTabs.peek()).toEqual([
        { executor: executors.executors.peek()[0], viewId: 'preview.view' },
      ])
      expect(executors.executors.peek()[0].editor).toBe(editor)
    }
  )

  it('falls back to an existing KCL file and leaves it editor-only without a matching view', async () => {
    const { app, data, editors, executors } = setup()
    registry.configure([
      editorsExtension,
      executorsExtension,
      projectSessionExtension,
    ])
    data.contents.children = [
      {
        name: 'part.kcl',
        path: `${data.contents.path}/part.kcl`,
        children: null,
      },
    ]
    vi.mocked(readProject).mockResolvedValueOnce(data)
    await localLoader({ app })({
      request: new Request('https://app.zoo.dev/local/test'),
      params: { path: data.contents.path },
      context: undefined,
      unstable_pattern: '/local/:path',
    })
    expect(editors.editors.peek()[0].src.peek()).toBe(
      `${data.contents.path}/part.kcl`
    )
    expect(executors.executors.peek()).toEqual([])
  })

  it.each(['cancel', 'replace'] as const)(
    'does not open stale editors or executors when a default-file read is superseded: %s',
    async (action) => {
      const { app, data, operations, sessions, editors, executors } = setup()
      data.contents.children = [
        {
          name: 'main.kcl',
          path: `${data.contents.path}/main.kcl`,
          children: null,
        },
      ]
      const controller = new AbortController()
      operations.readFile.mockImplementationOnce(async () => {
        if (action === 'cancel') controller.abort()
        else
          sessions.openProject({
            ...data,
            contents: { ...data.contents, path: '/next', children: [] },
          })
        return new TextEncoder().encode('stale')
      })
      vi.mocked(readProject).mockResolvedValueOnce(data)
      await expect(
        localLoader({ app })({
          request: new Request('https://app.zoo.dev/local/test', {
            signal: controller.signal,
          }),
          params: { path: data.contents.path },
          context: undefined,
          unstable_pattern: '/local/:path',
        })
      ).rejects.toBeInstanceOf(Error)
      expect(editors.editors.peek()).toEqual([])
      expect(executors.viewTabs.peek()).toEqual([])
    }
  )

  it.each([
    '/projects/524db2e0-53c9-4c6c-9d41-182755a692e6',
    'C:\\Users\\example\\Bracket demo',
    'cloud:local-directory',
  ])('treats the local route path literally: %s', async (path) => {
    const { app, data, operations } = setup()
    vi.mocked(readProject).mockResolvedValueOnce(data)
    await localLoader({ app })({
      request: new Request(
        `https://app.zoo.dev/local/${encodeURIComponent(path)}`
      ),
      params: { path },
      context: undefined,
      unstable_pattern: '/local/:path',
    })
    expect(readProject).toHaveBeenCalledWith(
      operations,
      path,
      expect.anything()
    )
  })

  it.each(['revoked', 'replaced'] as const)(
    'does not publish discovery through a session whose grant was %s',
    async (action) => {
      const { app, openProject, data } = setup()
      const discovery = Promise.withResolvers<typeof data>()
      vi.mocked(readProject).mockReturnValueOnce(discovery.promise)
      const loading = localLoader({ app })({
        request: new Request('https://app.zoo.dev/local/test'),
        params: { path: data.contents.path },
        context: undefined,
        unstable_pattern: '/local/:path',
      })
      // Wait until discovery has actually started, after ownership lookup.
      await vi.waitFor(() => expect(readProject).toHaveBeenCalledOnce())
      const replacement = { openProject: vi.fn() }
      if (action === 'revoked') environment.projectRouteEnabled = false
      else vi.spyOn(app.registry, 'optional').mockReturnValue(replacement)
      try {
        discovery.resolve(data)
        const result = await loading
        expect(result).toBeInstanceOf(Response)
        if (!(result instanceof Response))
          throw new Error('Expected a redirect')
        expect(result.headers.get('Location')).toBe(PATHS.HOME)
        expect(openProject).not.toHaveBeenCalled()
        expect(replacement.openProject).not.toHaveBeenCalled()
      } finally {
        environment.projectRouteEnabled = true
      }
    }
  )

  it('retains the active project when reading the next one fails', async () => {
    const { app, openProject, closeProject, data } = setup()
    const failure = new Error('Invalid project.toml')
    vi.mocked(readProject).mockRejectedValueOnce(failure)
    await expect(
      localLoader({ app })({
        request: new Request('https://app.zoo.dev/local/test'),
        params: { path: data.contents.path },
        context: undefined,
        unstable_pattern: '/local/:path',
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
      localLoader({ app })({
        request: new Request('https://app.zoo.dev/local/test', {
          signal: controller.signal,
        }),
        params: { path: data.contents.path },
        context: undefined,
        unstable_pattern: '/local/:path',
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(openProject).not.toHaveBeenCalled()
    expect(closeProject).not.toHaveBeenCalled()
  })
})

describe('cloud project loader', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['remote-123', '/projects/not-a-cloud-id', 'cloud:remote-123'])(
    'never treats a cloud-route ID as a local path: %s',
    async (id) => {
      const app = new App(App.getDefaultSystems())
      await expect(
        projectLoader({ app })({
          request: new Request(
            `https://app.zoo.dev/project/${encodeURIComponent(id)}`
          ),
          params: { id },
          context: undefined,
          unstable_pattern: '/project/:id',
        })
      ).rejects.toThrow('Cloud projects are not yet supported')
      expect(vi.spyOn(app.registry, 'get')).not.toHaveBeenCalled()
      expect(readProject).not.toHaveBeenCalled()
      expect(loadAndValidateSettings).not.toHaveBeenCalled()
    }
  )

  it('retains the feature gate without reading local storage', async () => {
    const app = new App(App.getDefaultSystems())
    environment.projectRouteEnabled = false
    try {
      const result = await projectLoader({ app })({
        request: new Request('https://app.zoo.dev/project/remote-123'),
        params: { id: 'remote-123' },
        context: undefined,
        unstable_pattern: '/project/:id',
      })
      expect(result).toBeInstanceOf(Response)
      if (!(result instanceof Response)) throw new Error('Expected a redirect')
      expect(result.headers.get('Location')).toBe(PATHS.HOME)
      expect(vi.spyOn(app.registry, 'get')).not.toHaveBeenCalled()
    } finally {
      environment.projectRouteEnabled = true
    }
  })
})
