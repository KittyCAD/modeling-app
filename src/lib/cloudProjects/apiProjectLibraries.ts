import type { ProjectLibraryResponse } from '@kittycad/lib'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  type ProjectLibrary,
} from '@src/lib/projectLibraries'

const API_LIBRARY_SOURCE_PREFIX = '/project-libraries/'

export function getApiProjectLibraryId(library: { source?: string }) {
  return library.source?.startsWith(API_LIBRARY_SOURCE_PREFIX)
    ? library.source.slice(API_LIBRARY_SOURCE_PREFIX.length)
    : undefined
}

export const apiProjectLibraryId = (id: string) => `cloud-library-${id}`

export function formatCloudLibraryLabel(name: string, organizationId?: string) {
  return `${name} (${organizationId ? 'Organization' : 'Personal'})`
}

export function apiProjectLibraries(
  libraries: readonly Pick<
    ProjectLibraryResponse,
    'id' | 'name' | 'org_id' | 'source'
  >[]
): ProjectLibrary[] {
  return libraries
    .toSorted(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    )
    .map((library) => ({
      id: apiProjectLibraryId(library.id),
      title: library.name,
      commandLabel: formatCloudLibraryLabel(library.name, library.org_id),
      type: CLOUD_PROJECT_LIBRARY_TYPE,
      source: `${API_LIBRARY_SOURCE_PREFIX}${library.id}`,
      path: `zoo://project-libraries/${library.id}`,
      hiddenByDefault: library.source === 'factory_portal',
      organizationId: library.org_id,
    }))
}
