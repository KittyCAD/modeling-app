import type { OPFSCloudSyncStatus } from '@src/lib/fs-zds/opfsCloud'
import { describe, expect, it } from 'vitest'
import { getCloudSyncStatusBarPresentation } from './index'

const status = (
  overrides: Partial<OPFSCloudSyncStatus>
): OPFSCloudSyncStatus => ({
  enabled: true,
  state: 'idle',
  pendingCount: 0,
  ...overrides,
})

describe('cloud sync status bar presentation', () => {
  it('uses distinct icons for synced, pending, syncing, and blocked states', () => {
    expect(getCloudSyncStatusBarPresentation(status({}))).toMatchObject({
      label: 'Cloud synced',
      icon: 'checkmark',
      iconClassName: '',
      isBlocked: false,
    })
    expect(
      getCloudSyncStatusBarPresentation(status({ pendingCount: 1 }))
    ).toMatchObject({
      label: 'Cloud sync pending',
      icon: 'refresh',
      iconClassName: '',
      isBlocked: false,
      tooltip: '1 cloud sync operation pending.',
    })
    expect(
      getCloudSyncStatusBarPresentation(status({ state: 'syncing' }))
    ).toMatchObject({
      label: 'Cloud syncing',
      icon: 'loading',
      iconClassName: 'animate-spin',
      isBlocked: false,
    })
    expect(
      getCloudSyncStatusBarPresentation(status({ state: 'failed' }))
    ).toMatchObject({
      label: 'Cloud sync failed',
      icon: 'triangleExclamation',
      isBlocked: true,
    })
    expect(
      getCloudSyncStatusBarPresentation(status({ state: 'conflict' }))
    ).toMatchObject({
      label: 'Cloud conflict',
      icon: 'triangleExclamation',
      isBlocked: true,
    })
  })

  it('uses the latest failure as the tooltip when present', () => {
    expect(
      getCloudSyncStatusBarPresentation(
        status({ lastFailure: 'Remote rejected update.', pendingCount: 2 })
      ).tooltip
    ).toBe('Remote rejected update.')
  })
})
