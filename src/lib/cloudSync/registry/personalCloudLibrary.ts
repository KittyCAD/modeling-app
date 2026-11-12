import { PERSONAL_CLOUD_PROJECT_LIBRARY_ID } from '@src/lib/projectLibraries'
import type { ProjectLibraryRelationshipMembershipPolicy } from '@src/registry/contracts/projectLibraries'

/** The built-in Personal Cloud library contains only non-organization projects. */
export const personalCloudProjectRelationshipMembershipPolicy = {
  libraryId: PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
  includes: ({ relationship }) =>
    relationship.remoteProject?.access?.scope !== 'organization',
} satisfies ProjectLibraryRelationshipMembershipPolicy
