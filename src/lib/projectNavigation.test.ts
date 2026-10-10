import {
  resolveProjectFileUrl,
  withProjectSubRoute,
} from '@src/lib/projectNavigation'
import { isDesktop } from '@src/lib/isDesktop'
import fsZds from '@src/lib/fs-zds'
import { posix } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import type { CloudProjectRelationship } from '@src/registry/contracts/cloudSync'

vi.mock('@src/lib/isDesktop', () => ({ isDesktop: vi.fn() }))
afterEach(() => vi.restoreAllMocks())

const library = {
  id: 'cloud-personal',
  title: 'Personal Cloud',
  type: 'cloud',
  path: '/cloud',
}
const realization = {
  id: 'prime',
  name: 'prime',
  localProjectName: 'prime',
  localProjectPath: '/cloud/prime',
  readWriteAccess: true,
  libraryIds: [library.id],
  libraryRefs: [library],
}
const relationship: CloudProjectRelationship = {
  id: 'cloud:remote-id',
  remoteProjectId: 'remote-id',
  canonicalRealization: {
    role: 'canonical',
    realization,
    duplicateRisk: 'exact',
    autoCleanupEligible: false,
  },
  localRealizations: [],
  duplicateRealizations: [],
}

test.each([
  { desktop: false, path: '/local/copy', cloud: true },
  { desktop: true, path: '/cloud/prime', cloud: true },
  { desktop: true, path: '/local/copy', cloud: false },
  { desktop: true, path: '/cloud/extra', cloud: false },
])(
  'chooses the project route for desktop=$desktop at $path',
  async ({ desktop, path, cloud }) => {
    vi.mocked(isDesktop).mockReturnValue(desktop)
    vi.spyOn(fsZds, 'relative').mockImplementation((from, to) =>
      posix.relative(from, to)
    )
    const syncNow = vi.fn(async () => ({ remoteProjectId: 'remote-id' }))
    const result = await resolveProjectFileUrl({
      project: { path, cloudProjectId: 'remote-id' },
      filePath: `${path}/parts/a.kcl`,
      libraries: [library],
      cloudSync: { getProjectMetadata: async () => undefined, syncNow },
      getRelationships: () => [relationship],
    })
    expect(result).toBe(
      cloud
        ? '/project/remote-id?file=parts%2Fa.kcl'
        : `/file/${encodeURIComponent(`${path}/parts/a.kcl`)}`
    )
    expect(syncNow).not.toHaveBeenCalled()
  }
)

test('waits for a new web project to receive its server UUID', async () => {
  vi.mocked(isDesktop).mockReturnValue(false)
  vi.spyOn(fsZds, 'relative').mockImplementation((from, to) =>
    posix.relative(from, to)
  )
  const syncNow = vi.fn(async () => ({ remoteProjectId: 'server-uuid' }))
  expect(
    await resolveProjectFileUrl({
      project: { path: '/cloud/new' },
      filePath: '/cloud/new/main.kcl',
      libraries: [library],
      cloudSync: { getProjectMetadata: async () => undefined, syncNow },
      getRelationships: () => [],
    })
  ).toBe('/project/server-uuid?file=main.kcl')
  expect(syncNow).toHaveBeenCalledWith('/cloud/new')
})

test('keeps the selected file when opening project settings', () => {
  expect(
    withProjectSubRoute(
      '/project/uuid?file=parts%2Fa.kcl',
      '/settings?tab=user'
    )
  ).toBe('/project/uuid/settings?file=parts%2Fa.kcl&tab=user')
})
