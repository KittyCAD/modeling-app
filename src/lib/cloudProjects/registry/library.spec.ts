import {
  homeProjectActionsService,
  type HomeProjectActionsService,
} from '@src/registry/contracts/homeProjects'
import {
  clearSessionExpiredNotice,
  sessionExpiredNotice,
} from '@src/lib/sessionExpired'
import { provide, Registry } from 'plankton'
import { signal } from '@preact/signals-core'
import type { UserOrgInfo } from '@kittycad/lib'
import { CREATE_CLOUD_LIBRARY_COMMAND } from '@src/lib/cloudProjects/commands'
import {
  authService,
  type AuthRegistryService,
} from '@src/registry/contracts/auth'
import {
  cloudStorageService,
  type CloudStorageService,
} from '@src/lib/cloudProjects/registry/contract'
import { homeProjectEntriesFacet } from '@src/registry/contracts/homeProjects'
import {
  getProjectLibraryOperation,
  projectLibraryTypesFacet,
} from '@src/registry/contracts/projectLibraries'
import {
  runtimeService,
  type RuntimeRegistryService,
} from '@src/registry/contracts/runtime'
import cloudProjects from '@src/lib/cloudProjects/registry/library'
import { afterEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createElement, createRef, Fragment } from 'react'
import { SaveStatusHeaderItem } from '@src/components/SaveStatusHeaderItem'
import {
  projectSession,
  type ProjectSessionService,
} from '@src/registry/contracts/projectSession'
import {
  commandSystemService,
  commandsFacet,
  type CommandSystemService,
} from '@src/registry/contracts/commands'
import { DELETE_CLOUD_LIBRARY_COMMAND } from '@src/lib/cloudProjects/libraryDeletion'
import {
  routerService,
  type RouterRegistryService,
} from '@src/registry/contracts/router'
import { PATHS } from '@src/lib/paths'
import type { RemoteProjectSummary } from '@src/lib/cloudProjects/runtime/types'

vi.mock('@src/lib/fs-zds', async () => ({
  default: (await import('@chainner/node-path')).posix,
}))

let registry: Registry | undefined
afterEach(async () => {
  await registry?.dispose()
  vi.unstubAllGlobals()
  clearSessionExpiredNotice()
})

it.each(['success', 'failure'] as const)(
  'requires a loaded project list after %s and retains libraries on delete conflicts',
  async (initialListing) => {
    let deleted = false
    let conflict = true
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_input, init) => {
        if (init?.method === 'DELETE') {
          if (conflict)
            return Response.json(
              { message: 'Library is not empty' },
              { status: 409 }
            )
          deleted = true
          return new Response(null, { status: 204 })
        }
        return Response.json({
          items: deleted
            ? []
            : [
                {
                  id: 'empty',
                  name: 'Designs',
                  source: 'zds',
                  can_manage: true,
                  revision: 'library-revision',
                },
              ],
          next_page: null,
        })
      })
    )
    const listing = Promise.withResolvers<RemoteProjectSummary[]>()
    const projects = signal<RemoteProjectSummary[]>([])
    const projectsLoading = signal(false)
    const listProjects = vi
      .fn()
      .mockImplementationOnce(() => {
        projectsLoading.value = true
        return listing.promise.finally(() => {
          projectsLoading.value = false
        })
      })
      .mockResolvedValue([])
    const navigate = vi.fn()
    registry = new Registry()
    await registry.configure([
      cloudProjects,
      provide(authService, {
        user: signal({ id: 'user' }),
        token: signal('token'),
        isLoggedIn: signal(true),
        organization: {
          current: signal(undefined),
          loading: signal(false),
          error: signal(undefined),
          refresh: vi.fn(async () => {}),
        },
      } as unknown as AuthRegistryService),
      provide(runtimeService, {
        current: signal({ apiBaseUrl: 'https://api.test' }),
      } as unknown as RuntimeRegistryService),
      provide(routerService, {
        location: signal({ pathname: `${PATHS.LIBRARY}/cloud-library-empty` }),
        navigate,
      } as unknown as RouterRegistryService),
      provide(cloudStorageService, {
        projects,
        projectsLoading,
        listProjects,
        thumbnails: signal(new Map()),
        root: '/__zoo_cloud__',
        saves: signal(new Map()),
      } as unknown as CloudStorageService),
    ])
    const libraryTypes = registry.observe(projectLibraryTypesFacet)
    const libraries = () => libraryTypes.value.get('cloud')?.libraries ?? []
    await vi.waitFor(() => expect(libraries()).toHaveLength(2))
    const library = libraries().find(
      (library) => library.id === 'cloud-library-empty'
    )!
    const Menu = registry.get(projectLibraryTypesFacet).get('cloud')!
      .homeContextMenu!
    const menuTargetElement = createRef<HTMLDivElement>()
    const view = render(
      createElement(
        Fragment,
        null,
        createElement('div', { ref: menuTargetElement }, 'Designs'),
        createElement(Menu, { library, projects: [], menuTargetElement })
      )
    )
    fireEvent.contextMenu(screen.getByText('Designs'))
    expect(screen.queryByRole('button', { name: /Delete library/ })).toBeNull()
    await act(async () => {
      if (initialListing === 'success') listing.resolve([])
      else listing.reject(new Error('Project list failed'))
      await listing.promise.catch(() => undefined)
    })
    const command = () =>
      registry!
        .get(commandsFacet)
        .find((command) => command.name === DELETE_CLOUD_LIBRARY_COMMAND)!
    if (initialListing === 'failure') {
      expect(command().disabled).toBe(true)
      expect(
        screen.queryByRole('button', { name: /Delete library/ })
      ).toBeNull()
      await act(async () => {
        await libraryTypes.value.get('cloud')!.operations!.refresh!.run({
          library,
        })
      })
    }
    await vi.waitFor(() => expect(command().disabled).toBe(false))
    expect(screen.queryByRole('button', { name: /Delete library/ })).toBeNull()
    fireEvent.contextMenu(screen.getByText('Designs'))
    expect(screen.getByRole('button', { name: /Delete library/ })).toBeTruthy()
    act(() => {
      projects.value = [{ id: 'project', library_id: 'empty' }]
    })
    await vi.waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /Delete library/ })
      ).toBeNull()
    )
    act(() => {
      projects.value = []
    })
    await expect(
      command().onSubmit({ library: 'empty' })
    ).rejects.toMatchObject({
      status: 409,
    })
    expect(libraries()).toContainEqual(
      expect.objectContaining({ id: library.id })
    )
    expect(navigate).not.toHaveBeenCalled()
    conflict = false
    await command().onSubmit({ library: 'empty' })
    await vi.waitFor(() => expect(libraries()).toHaveLength(1))
    expect(navigate).toHaveBeenCalledExactlyOnceWith(PATHS.HOME)
    view.unmount()
  }
)
it('discovers paged libraries, groups read-only projects, and drops an old account catalog response', async () => {
  const oldRequest = Promise.withResolvers<Response>()
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        items: [{ id: 'dataset', name: 'Dataset', source: 'org_dataset' }],
        next_page: 'next cursor',
      })
    )
    .mockResolvedValueOnce(
      Response.json({
        items: [
          { id: 'factory', name: 'Jobs', source: 'factory_portal' },
          { id: 'future', name: 'Future', source: 'new_source' },
        ],
        next_page: null,
      })
    )
    .mockReturnValueOnce(oldRequest.promise)
    .mockImplementation(async () =>
      Response.json({
        items: [{ id: 'second', name: 'Second account' }],
        next_page: null,
      })
    )
  vi.stubGlobal('fetch', fetchMock)
  const user = signal({ id: 'first' })
  const token = signal('first-token')
  const organization = signal<UserOrgInfo | undefined>(undefined)
  const send = vi.fn()
  registry = new Registry()
  await registry.configure([
    cloudProjects,
    provide(projectSession, {
      project: signal({
        path: '/__zoo_cloud__/model',
        executingEditor: signal(undefined),
      }),
      storageFor: () => ({
        writeAvailability: signal({
          writable: false,
          reason: 'Read-only project.',
        }),
      }),
    } as unknown as ProjectSessionService),
    provide(commandSystemService, { send } as unknown as CommandSystemService),
    provide(homeProjectActionsService, {
      canDuplicateToLibrary: () => true,
    } as unknown as HomeProjectActionsService),
    provide(authService, {
      user,
      token,
      isLoggedIn: signal(true),
      organization: {
        current: organization,
        loading: signal(false),
        error: signal(undefined),
        refresh: vi.fn(async () => {}),
      },
    } as unknown as AuthRegistryService),
    provide(runtimeService, {
      current: signal({ apiBaseUrl: 'https://api.test' }),
    } as unknown as RuntimeRegistryService),
    provide(cloudStorageService, {
      projects: signal([
        {
          id: 'model',
          library_id: 'dataset',
          title: 'Model',
          access: { scope: 'organization', can_edit: false },
        },
      ]),
      thumbnails: signal(new Map()),
      root: '/__zoo_cloud__',
      idFor: () => 'model',
      isReadOnlyProject: () => true,
      saves: signal(new Map()),
    } as unknown as CloudStorageService),
  ])
  const libraryTypes = registry.observe(projectLibraryTypesFacet)
  const libraries = () => libraryTypes.value.get('cloud')?.libraries ?? []
  await vi.waitFor(() => expect(libraries()).toHaveLength(4))
  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
    'https://api.test/user/project-libraries',
    'https://api.test/user/project-libraries?page_token=next+cursor',
  ])
  expect(
    new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')
  ).toBe('Bearer first-token')
  const createLibrary = registry
    .get(commandsFacet)
    .find((command) => command.name === CREATE_CLOUD_LIBRARY_COMMAND)
  const owner = createLibrary?.args?.scope
  if (owner?.inputType !== 'options' || typeof owner.options !== 'function')
    throw new Error('Expected library owner options')
  const ownerOptions = owner.options
  const ownerNames = () =>
    ownerOptions({ argumentsToSubmit: {} }).map((option) => option.name)
  expect(ownerNames()).toEqual(['Personal'])
  organization.value = {
    id: 'organization-a',
    name: 'Design team',
    role: 'member',
    created_at: '2026-11-23T00:00:00Z',
    updated_at: '2026-11-23T00:00:00Z',
  }
  expect(ownerNames()).toEqual(['Personal', 'Design team'])
  organization.value = undefined
  expect(ownerNames()).toEqual(['Personal'])
  expect(fetchMock).toHaveBeenCalledTimes(2)
  const type = libraryTypes.value.get('cloud')
  expect(
    libraries()
      .filter((library) => library.hiddenByDefault)
      .map((library) => library.id)
  ).toEqual(['cloud-library-factory'])
  const factoryLibrary = libraries().find(
    (library) => library.id === 'cloud-library-factory'
  )!
  const entries = registry.get(homeProjectEntriesFacet)
  expect(entries).toEqual([
    expect.objectContaining({
      remoteProjectId: 'model',
      libraryIds: ['cloud-library-dataset'],
      readWriteAccess: false,
    }),
  ])
  expect(
    getProjectLibraryOperation(type, factoryLibrary, 'createProject')
  ).toBeUndefined()
  expect(
    getProjectLibraryOperation(type, factoryLibrary, 'cloneProjectTo')
  ).toBeUndefined()
  const dataset = libraries().find(
    (library) => library.id === 'cloud-library-dataset'
  )!
  expect(
    getProjectLibraryOperation(type, dataset, 'createProject')
  ).toBeDefined()
  expect(
    getProjectLibraryOperation(
      type,
      dataset,
      'cloneProjectFrom'
    )?.canCloneProject?.({ library: dataset, project: entries[0] })
  ).toBe(true)
  const view = render(
    createElement(SaveStatusHeaderItem, { app: { registry } })
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Create an editable copy' })
  )
  expect(send).toHaveBeenCalledWith({
    type: 'Find and select command',
    data: {
      groupId: 'projects',
      name: 'Duplicate project',
      argDefaultValues: { project: entries[0].id },
    },
  })
  view.unmount()
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  user.value = { id: 'second' }
  token.value = 'second-token'
  expect(
    libraries().some((library) => library.id === 'cloud-library-dataset')
  ).toBe(false)
  await vi.waitFor(() =>
    expect(
      libraries().some((library) => library.id === 'cloud-library-second')
    ).toBe(true)
  )
  oldRequest.resolve(
    Response.json({ message: 'Old token expired' }, { status: 401 })
  )
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  expect(libraries().map((library) => library.id)).toEqual([
    'cloud-personal',
    'cloud-library-second',
  ])
  expect(sessionExpiredNotice.value).toBeUndefined()

  const created = { id: 'designs', name: 'Designs', source: 'zds' }
  const refreshedCatalog = Promise.withResolvers<Response>()
  fetchMock
    .mockResolvedValueOnce(Response.json(created, { status: 201 }))
    .mockReturnValueOnce(refreshedCatalog.promise)
  try {
    await createLibrary!.onSubmit({ name: 'Designs' })
    expect(libraries().map((library) => library.id)).toEqual([
      'cloud-personal',
      'cloud-library-designs',
      'cloud-library-second',
    ])
  } finally {
    refreshedCatalog.resolve(
      Response.json({
        items: [created, { id: 'second', name: 'Second account' }],
        next_page: null,
      })
    )
  }
})
