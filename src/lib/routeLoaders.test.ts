import { signal } from '@preact/signals-core'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import { defineRegistryItem, provideService } from '@kittycad/registry'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import type * as FsZdsModule from '@src/lib/fs-zds'
import type { ZDSProject } from '@src/lib/projectSession'
import { App } from '@src/lib/app'
import '@src/lib/projectSession/next/testFeature'
import { Registry } from '@kittycad/registry'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import projectSessionExtension from '@src/lib/projectSession/registry'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import type { Project } from '@src/lib/projectSession/next/types'
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
vi.mock('@src/lib/fs-zds', async (importOriginal) => ({
  ...(await importOriginal<typeof FsZdsModule>()),
  default: (await import('@chainner/node-path')).posix,
}))

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
  it('opens another file in the current project without reloading settings or the project', async () => {
    const app = new App(App.getDefaultSystems())
    const openEditor = vi.fn(async () => undefined)
    const registryGet = vi.spyOn(app.registry, 'get')
    app.project = { path: '/project', openEditor } as unknown as ZDSProject
    Object.defineProperty(app, 'fileOperations', {
      value: { exists: vi.fn(async () => true) },
    })
    const id = '/project/other.kcl'
    await fileLoader({ app })({
      request: new Request(
        `https://app.zoo.dev/file/${encodeURIComponent(id)}`
      ),
      params: { id },
      context: undefined,
      unstable_pattern: '/file/:id',
    })
    expect(openEditor).toHaveBeenCalledWith(
      id,
      app.singletons.kclManager,
      undefined,
      true,
      expect.any(Function),
      { deferModeling: true }
    )
    expect(loadAndValidateSettings).not.toHaveBeenCalled()
    expect(registryGet).not.toHaveBeenCalled()
  })

  it('canonicalizes an explicit local id without requesting cloud services', async () => {
    const app = new App(App.getDefaultSystems())
    const registryGet = vi.spyOn(app.registry, 'get')
    const id = 'local:/projects/example/main.kcl'
    const result = await fileLoader({ app })({
      request: new Request(
        `https://app.zoo.dev/file/${encodeURIComponent(id)}/onboarding/desktop/scene?mode=test`
      ),
      params: { id },
      context: undefined,
      unstable_pattern: '/file/:id',
    })
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).headers.get('Location')).toBe(
      '/file/%2Fprojects%2Fexample%2Fmain.kcl/onboarding/desktop/scene?mode=test'
    )
    expect(registryGet).not.toHaveBeenCalled()
    expect(loadAndValidateSettings).not.toHaveBeenCalled()
  })

  it('refreshes a direct cloud file route before loading project settings', async () => {
    const app = new App(App.getDefaultSystems())
    const refreshed = Promise.withResolvers<undefined>()
    const refreshProject = vi.fn(() => refreshed.promise)
    const openProject = vi.fn()
    vi.spyOn(app.registry, 'get').mockReturnValue({
      root: '/__zoo_cloud__',
      idFor: () => 'one',
      refreshProject,
      openProject,
    })
    const id = '/__zoo_cloud__/one/parts/main.kcl'
    const loading = fileLoader({ app })({
      request: new Request(
        `https://app.zoo.dev/file/${encodeURIComponent(id)}`
      ),
      params: { id },
      context: undefined,
      unstable_pattern: '/file/:id',
    })
    await vi.waitFor(() =>
      expect(refreshProject).toHaveBeenCalledWith('one', expect.any(Function))
    )
    expect(loadAndValidateSettings).not.toHaveBeenCalled()
    const finished = expect(loading).rejects.toThrow(
      'Unexpected project lookup'
    )
    refreshed.resolve(undefined)
    await finished
    expect(openProject).not.toHaveBeenCalled()
  })
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
    registry.configure([editorsExtension, projectSessionExtension])
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
    'opens $expected as an editor (configured: $configured)',
    async ({ configured, expected }) => {
      const { app, data, editors, operations } = setup()
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
      expect(editor.contents.value).toBe('file contents')
      expect(operations.readFile).toHaveBeenCalledExactlyOnceWith(
        editor.src.peek()
      )
    }
  )

  it('falls back to an existing KCL file', async () => {
    const { app, data, editors } = setup()
    registry.configure([editorsExtension, projectSessionExtension])
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
  })

  it.each(['cancel', 'replace'] as const)(
    'does not open stale editors when a default-file read is superseded: %s',
    async (action) => {
      const { app, data, operations, sessions, editors } = setup()
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

  it.each(['/projects/not-a-cloud-id', 'cloud:remote-123', '..'])(
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
      ).rejects.toThrow('Expected a cloud project API ID')
      expect(vi.spyOn(app.registry, 'get')).not.toHaveBeenCalled()
      expect(readProject).not.toHaveBeenCalled()
      expect(loadAndValidateSettings).not.toHaveBeenCalled()
    }
  )

  function setupCloud() {
    const app = new App(App.getDefaultSystems())
    const registry = new Registry()
    const readFile = vi.fn(async () =>
      new TextEncoder().encode('cloud file contents')
    )
    registry.configure([
      editorsExtension,
      projectSessionExtension,
      defineRegistryItem({
        providesServices: [
          provideService(fileOperationsService, {
            ...testFileOperations,
            readFile,
          }),
        ],
      }),
    ])
    const path = '/__zoo_cloud__/api-id'
    const cloud = {
      openProject: vi.fn(async () => path),
      projects: signal([{ id: 'api-id', title: 'Cloud bracket' }]),
    }
    vi.spyOn(app.registry, 'get').mockImplementation((token) =>
      Object.is(token, cloudStorageService) ? cloud : registry.get(token)
    )
    vi.spyOn(app.registry, 'optional').mockImplementation((token) =>
      Object.is(token, cloudStorageService) ? cloud : registry.optional(token)
    )
    const project: Project = {
      contents: {
        name: 'api-id',
        path,
        children: [
          { name: 'main.kcl', path: `${path}/main.kcl`, children: null },
        ],
      },
      metadata: { title: 'api-id', readWriteAccess: true },
    }
    vi.mocked(readProject).mockResolvedValue(project)
    return {
      app,
      registry,
      cloud,
      project,
      readFile,
      closeProject: vi.spyOn(app, 'closeProject'),
    }
  }

  it('opens the API ID through cloud storage and loads its initial editor from the returned mount', async () => {
    const { app, registry, cloud, readFile } = setupCloud()
    try {
      await projectLoader({ app })({
        request: new Request('https://app.zoo.dev/project/api-id'),
        params: { id: 'api-id' },
        context: undefined,
        unstable_pattern: '/project/:id',
      })
      expect(cloud.openProject).toHaveBeenCalledWith('api-id')
      const session = registry.get(projectSessionService).currentSession.peek()!
      expect(session.project.peek().storage).toEqual({
        type: 'cloud',
        projectId: 'api-id',
      })
      expect(session.project.peek().metadata.title).toBe('Cloud bracket')
      const editor = registry.get(editorsService).editors.peek()[0]
      expect(editor.src.peek()).toBe('/__zoo_cloud__/api-id/main.kcl')
      expect(editor.contents.peek()).toBe('cloud file contents')
      expect(registry.get(editorsService).views.peek()[0].editor).toBe(editor)
      expect(readFile).toHaveBeenCalledWith('/__zoo_cloud__/api-id/main.kcl')
      expect(loadAndValidateSettings).not.toHaveBeenCalled()
    } finally {
      registry[Symbol.dispose]()
    }
  })

  it.each(['cancel', 'failure'] as const)(
    'preserves the selected project after opening %s',
    async (kind) => {
      const { app, registry, cloud, project, closeProject } = setupCloud()
      try {
        const projects = registry.get(projectSessionService)
        const previous = projects.openProject(project)
        const controller = new AbortController()
        if (kind === 'cancel')
          cloud.openProject.mockImplementationOnce(async () => {
            controller.abort()
            return project.contents.path
          })
        else
          vi.mocked(readProject).mockRejectedValueOnce(
            new Error('Download failed')
          )
        await expect(
          projectLoader({ app })({
            request: new Request('https://app.zoo.dev/project/api-id', {
              signal: controller.signal,
            }),
            params: { id: 'api-id' },
            context: undefined,
            unstable_pattern: '/project/:id',
          })
        ).rejects.toBeInstanceOf(Error)
        expect(projects.currentSession.peek()).toBe(previous)
        expect(registry.get(editorsService).editors.peek()).toHaveLength(0)
        expect(closeProject).not.toHaveBeenCalled()
      } finally {
        registry[Symbol.dispose]()
      }
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
