import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { batch, signal } from '@preact/signals-core'
import type { UserResponse } from '@kittycad/lib'
import { apiProjectLibrariesExtension } from '@src/lib/cloudSync/registry/apiProjectLibraries'
import { personalCloudProjectRelationshipMembershipPolicy } from '@src/lib/cloudSync/registry/personalCloudLibrary'
import {
  getDefaultCloudProjectLibrarySetting,
  projectLibrariesFromSettings,
} from '@src/lib/projectLibraries'
import {
  authService,
  type AuthRegistryService,
} from '@src/registry/contracts/auth'
import type { CloudProjectRelationship } from '@src/registry/contracts/cloudSync'
import { projectLibraryTypesValueSpec } from '@src/registry/contracts/projectLibraries'
import {
  runtimeService,
  type RuntimeInfo,
} from '@src/registry/contracts/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@src/lib/cloudSync/cloudApi', () => ({
  listRemoteProjectLibraries: api.list,
}))
vi.mock('@src/lib/cloudSync/paths', () => ({
  getCloudProjectLibraryMaterializationDirectoryPath: async () =>
    '/cloud/personal',
}))
vi.mock('@src/lib/fs-zds', async () => ({
  default: (await import('node:path')).posix,
}))

describe('API project library discovery', () => {
  let registry: Registry | undefined

  beforeEach(() => {
    api.list.mockReset()
  })
  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
    vi.restoreAllMocks()
  })

  function configure() {
    const token = signal('first-token')
    const user = signal({ id: 'first-user' } as UserResponse)
    const runtime = signal({
      apiBaseUrl: 'https://first.example',
      environmentName: 'first',
    } as RuntimeInfo)
    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test.library-auth',
        providesServices: [
          provideService(authService, { token, user } as AuthRegistryService),
          provideService(runtimeService, {
            current: runtime,
            get: () => runtime.value,
            refresh: () => runtime.value,
          }),
        ],
      }),
      apiProjectLibrariesExtension,
    ])
    const libraries = () =>
      projectLibrariesFromSettings(
        [getDefaultCloudProjectLibrarySetting()],
        registry!.get(projectLibraryTypesValueSpec)
      )
    libraries()
    return { token, user, runtime, libraries }
  }

  it('adds API libraries to configured libraries and hides only Factory by default', async () => {
    api.list.mockResolvedValue([
      {
        id: 'dataset',
        name: 'Dataset conversions (00000000-0000-4000-8000-000000000001)',
        source: 'org_dataset',
      },
      { id: 'factory', name: 'Factory jobs', source: 'factory_portal' },
      {
        id: 'designs',
        name: 'Designs (00000000-0000-4000-8000-000000000001)',
        source: 'zds',
      },
      { id: 'future', name: 'Other library', source: 'future_source' },
    ])
    const { libraries } = configure()
    await vi.waitFor(() => expect(libraries()).toHaveLength(5))
    expect(
      libraries()
        .filter((library) => !library.hiddenByDefault)
        .map((library) => library.title)
    ).toEqual([
      'Personal Cloud',
      'Dataset conversions',
      'Designs (00000000-0000-4000-8000-000000000001)',
      'Other library',
    ])
    expect(
      libraries().find((library) => library.title === 'Factory jobs')
    ).toMatchObject({ hiddenByDefault: true })

    const relationship = {
      remoteProject: { id: 'project', library_id: 'dataset' },
    } as CloudProjectRelationship
    const policies = registry!.get(projectLibraryTypesValueSpec).get('cloud')!
      .relationshipMembershipPolicies!
    expect(
      policies
        .filter((policy) => policy.includes({ relationship }))
        .map((policy) => policy.libraryId)
    ).toEqual(['cloud-library-dataset'])
    expect(
      personalCloudProjectRelationshipMembershipPolicy.includes({
        relationship,
      })
    ).toBe(false)

    const id = libraries().find(
      (library) => library.title === 'Dataset conversions'
    )!.id
    api.list.mockResolvedValue([
      { id: 'dataset', name: 'Renamed dataset', source: 'org_dataset' },
    ])
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() =>
      expect(libraries().find((library) => library.id === id)?.title).toBe(
        'Renamed dataset'
      )
    )
  })

  it('aborts old account requests and ignores their results after a scope change', async () => {
    let finishOld!: (libraries: { id: string; name: string }[]) => void
    api.list
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve
          })
      )
      .mockResolvedValue([{ id: 'new', name: 'New account library' }])
    const { token, user, runtime, libraries } = configure()
    await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(1))
    const oldSignal = api.list.mock.calls[0][1] as AbortSignal
    batch(() => {
      token.value = 'second-token'
      user.value = { id: 'second-user' } as UserResponse
      runtime.value = { ...runtime.value, apiBaseUrl: 'https://second.example' }
    })
    await vi.waitFor(() =>
      expect(
        libraries().some((library) => library.title === 'New account library')
      ).toBe(true)
    )
    expect(oldSignal.aborted).toBe(true)
    finishOld([{ id: 'old', name: 'Old account library' }])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(
      libraries().some((library) => library.title === 'Old account library')
    ).toBe(false)
    expect(api.list.mock.calls.at(-1)?.[0]).toMatchObject({
      token: 'second-token',
      baseUrl: 'https://second.example',
    })

    token.value = ''
    await vi.waitFor(() => expect(libraries()).toHaveLength(1))
  })
})
