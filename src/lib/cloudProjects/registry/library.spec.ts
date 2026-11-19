import {
  clearSessionExpiredNotice,
  sessionExpiredNotice,
} from '@src/lib/sessionExpired'
import { provide, Registry } from 'plankton'
import { signal } from '@preact/signals-core'
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
import { projectLibrariesFromSettings } from '@src/lib/projectLibraries'
import cloudProjects from '@src/lib/cloudProjects/registry/library'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@src/lib/fs-zds', async () => ({
  default: (await import('@chainner/node-path')).posix,
}))

let registry: Registry | undefined
afterEach(async () => {
  await registry?.dispose()
  vi.unstubAllGlobals()
  clearSessionExpiredNotice()
})

it('discovers paged libraries, groups projects, and drops an old account catalog response', async () => {
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
  registry = new Registry()
  await registry.configure([
    cloudProjects,
    provide(authService, {
      user,
      token,
      isLoggedIn: signal(true),
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
      saves: signal(new Map()),
    } as unknown as CloudStorageService),
  ])
  const libraries = () =>
    projectLibrariesFromSettings([], registry!.get(projectLibraryTypesFacet))
  await vi.waitFor(() => expect(libraries()).toHaveLength(4))
  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
    'https://api.test/user/project-libraries',
    'https://api.test/user/project-libraries?page_token=next+cursor',
  ])
  expect(
    new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')
  ).toBe('Bearer first-token')
  expect(
    libraries()
      .filter((library) => library.hiddenByDefault)
      .map((library) => library.id)
  ).toEqual(['cloud-library-factory'])
  const entries = registry.get(homeProjectEntriesFacet)
  expect(entries).toEqual([
    expect.objectContaining({
      remoteProjectId: 'model',
      libraryIds: ['cloud-library-dataset'],
      readWriteAccess: false,
    }),
  ])
  const type = registry.get(projectLibraryTypesFacet).get('cloud')
  const dataset = libraries().find(
    (library) => library.id === 'cloud-library-dataset'
  )!
  expect(
    getProjectLibraryOperation(type, dataset, 'createProject')
  ).toBeUndefined()
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
})
