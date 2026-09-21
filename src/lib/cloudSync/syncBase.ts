import type {
  AcknowledgedSyncBase,
  ProjectMetadata,
} from '@src/lib/cloudSync/types'

/**
 * Parse the independently optional fields in the persisted IndexedDB record
 * into the synchronization base required by guarded cloud operations.
 */
export function parseAcknowledgedSyncBase(
  metadata: Pick<ProjectMetadata, 'remoteRevision' | 'baseManifest'>
): AcknowledgedSyncBase | undefined {
  if (!metadata.remoteRevision || !metadata.baseManifest) {
    return undefined
  }

  return {
    revision: metadata.remoteRevision,
    manifest: metadata.baseManifest,
  }
}
