import { PERSONAL_CLOUD_PROJECT_LIBRARY_ID } from '@src/lib/projectLibraries'
import type { ProjectLibraryRelationshipMembershipPolicy } from '@src/registry/contracts/projectLibraries'

/** Personal Cloud contains unassigned personal projects. */
export const personalCloudProjectRelationshipMembershipPolicy = {
  libraryId: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  includes: ({ relationship }) =>
    relationship.remoteProject?.access?.scope !== 'organization' &&
    !relationship.remoteProject?.library_id,
} satisfies ProjectLibraryRelationshipMembershipPolicy
