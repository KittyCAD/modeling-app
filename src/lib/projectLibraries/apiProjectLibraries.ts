import type { RemoteProjectLibrary } from '@src/lib/fs-zds/cloud/api'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  type ProjectLibrary,
} from '@src/lib/projectLibraries'

const API_LIBRARY_SOURCE_PREFIX = '/project-libraries/'

export function isApiProjectLibrary(library: { source?: string }) {
  return library.source?.startsWith(API_LIBRARY_SOURCE_PREFIX) ?? false
}

export const apiProjectLibraryId = (id: string) => `cloud-library-${id}`

export function apiProjectLibraries(
  libraries: readonly RemoteProjectLibrary[]
): ProjectLibrary[] {
  return libraries
    .toSorted(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    )
    .map((library) => ({
      id: apiProjectLibraryId(library.id),
      title:
        library.source === 'org_dataset'
          ? library.name.replace(
              / \([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\)$/i,
              ''
            )
          : library.name,
      type: CLOUD_PROJECT_LIBRARY_TYPE,
      source: `${API_LIBRARY_SOURCE_PREFIX}${library.id}`,
      path: `zoo://project-libraries/${library.id}`,
      hiddenByDefault: library.source === 'factory_portal',
    }))
}
