import {
  clearSessionExpiredNotice,
  sessionExpiredNotice,
} from '@src/lib/sessionExpired'
import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  authService,
  type AuthRegistryService,
} from '@src/registry/contracts/auth'
import {
  cloudStorageService,
  type CloudStorageService,
} from '@src/registry/contracts/fileOperations'
import { homeProjectEntriesValueSpec } from '@src/registry/contracts/homeProjects'
import {
  getProjectLibraryOperation,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import {
  runtimeService,
  type RuntimeRegistryService,
} from '@src/registry/contracts/runtime'
import { projectLibrariesFromSettings } from '@src/lib/projectLibraries'
import cloudProjects from '@src/registry/extensions/cloudProjects'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { FileSaveStatus } from '@src/components/FileSaveStatus'
import type { App } from '@src/lib/app'

let registry: Registry | undefined
afterEach(() => {
  cleanup()
  registry?.[Symbol.dispose]()
  vi.unstubAllGlobals()
  clearSessionExpiredNotice()
})

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
  registry = new Registry()
  registry.configure([
    cloudProjects,
    defineRegistryItem({
      id: 'catalog-services',
      providesServices: [
        provideService(authService, {
          user,
          token,
          isLoggedIn: signal(true),
        } as unknown as AuthRegistryService),
        provideService(runtimeService, {
          current: signal({ apiBaseUrl: 'https://api.test' }),
        } as unknown as RuntimeRegistryService),
        provideService(cloudStorageService, {
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
      ],
    }),
  ])
  const libraries = () =>
    projectLibrariesFromSettings(
      [],
      registry!.get(projectLibraryTypesValueSpec)
    )
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
  const entries = registry.get(homeProjectEntriesValueSpec)
  expect(entries).toEqual([
    expect.objectContaining({
      remoteProjectId: 'model',
      libraryIds: ['cloud-library-dataset'],
      readWriteAccess: false,
    }),
  ])
  const type = registry.get(projectLibraryTypesValueSpec).get('cloud')
  const dataset = libraries().find(
    (library) => library.id === 'cloud-library-dataset'
  )!
  expect(
    getProjectLibraryOperation(type, dataset, 'createProject')
  ).toBeUndefined()
  expect(
    getProjectLibraryOperation(
      type,
      dataset,
      'cloneProjectFrom'
    )?.canCloneProject?.({ library: dataset, project: entries[0] })
  ).toBe(true)
  const send = vi.fn()
  render(createElement(FileSaveStatus, { app: {
    registry,
    projectSignal: signal({ path: '/__zoo_cloud__/model', executingEditor: signal(undefined) }),
    commands: { send },
  } as unknown as App }))
  fireEvent.click(screen.getByRole('button', { name: 'Create an editable copy' }))
  expect(send).toHaveBeenCalledWith({ type: 'Find and select command', data: {
    groupId: 'projects', name: 'Clone project', argDefaultValues: { project: entries[0].id },
  } })
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
