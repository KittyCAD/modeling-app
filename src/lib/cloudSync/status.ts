import { signal } from '@preact/signals-core'
import type { CloudSyncStatus } from '@src/lib/cloudSync/types'

/** Cloud-sync-owned status for the active project scope and background work. */
export const cloudSyncStatus = signal<CloudSyncStatus>({
  enabled: false,
  state: 'disabled',
  pendingCount: 0,
})
