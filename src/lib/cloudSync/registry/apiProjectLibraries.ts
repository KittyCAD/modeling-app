import { defineRegistryItemFactory, provide } from '@kittycad/registry'
import { computed, effect, signal } from '@preact/signals-core'
import {
  listRemoteProjectLibraries,
  type RemoteProjectLibrary,
} from '@src/lib/cloudSync/cloudApi'
import { getCloudProjectLibraryMaterializationDirectoryPath } from '@src/lib/cloudSync/paths'
import fsZds from '@src/lib/fs-zds'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  getDefaultCloudProjectLibrarySetting,
  type ProjectLibrary,
} from '@src/lib/projectLibraries'
import { reportRejection } from '@src/lib/trap'
import { authService } from '@src/registry/contracts/auth'
import {
  type ProjectLibraryTypeContribution,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { runtimeService } from '@src/registry/contracts/runtime'

const API_LIBRARY_SOURCE_PREFIX = '/project-libraries/'

export function isApiProjectLibrary(library: { source?: string }) {
  return library.source?.startsWith(API_LIBRARY_SOURCE_PREFIX) ?? false
}

export function apiProjectLibraries(
  libraries: readonly RemoteProjectLibrary[],
  personalLibraryPath: string
): ProjectLibrary[] {
  return libraries
    .toSorted(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    )
    .map((library) => ({
      id: `cloud-library-${library.id}`,
      // Dataset libraries append a dataset UUID for backend uniqueness.
      title:
        library.source === 'org_dataset'
          ? library.name.replace(
              / \([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\)$/i,
              ''
            )
          : library.name,
      type: CLOUD_PROJECT_LIBRARY_TYPE,
      source: `${API_LIBRARY_SOURCE_PREFIX}${library.id}`,
      path: fsZds.join(
        fsZds.dirname(personalLibraryPath),
        'libraries',
        `library-${encodeURIComponent(library.id)}`
      ),
      hiddenByDefault: library.source === 'factory_portal',
    }))
}

export const apiProjectLibrariesExtension = defineRegistryItemFactory((ctx) => {
  const auth = ctx.services.signal(authService)
  const runtime = ctx.services.signal(runtimeService)
  const libraries = signal<ProjectLibrary[]>([])
  const refresh = signal(0)
  let scopeKey: string | undefined
  let disposed = false
  let stop: (() => void) | undefined

  const onVisibilityChange = () => {
    if (!document.hidden) refresh.value += 1
  }

  queueMicrotask(() => {
    if (disposed) return
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
    stop = effect(() => {
      const token = auth.value?.token.value
      const user = auth.value?.user.value
      const currentRuntime = runtime.value?.current.value
      const baseUrl = currentRuntime?.apiBaseUrl
      void refresh.value
      const nextScopeKey = JSON.stringify([
        token,
        user,
        baseUrl,
        currentRuntime?.environmentName,
      ])
      if (scopeKey !== nextScopeKey) {
        scopeKey = nextScopeKey
        libraries.value = []
      }
      if (!token || !baseUrl) return

      const controller = new AbortController()
      void Promise.all([
        listRemoteProjectLibraries(
          { enabled: true, token, baseUrl },
          controller.signal
        ),
        getCloudProjectLibraryMaterializationDirectoryPath(
          getDefaultCloudProjectLibrarySetting()
        ),
      ])
        .then(([remoteLibraries, personalPath]) => {
          if (!controller.signal.aborted && !disposed) {
            libraries.value = apiProjectLibraries(remoteLibraries, personalPath)
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted && !disposed) reportRejection(error)
        })
      return () => controller.abort()
    })
  })

  const contribution = computed<ProjectLibraryTypeContribution>(() => ({
    type: CLOUD_PROJECT_LIBRARY_TYPE,
    title: 'Cloud',
    libraries: libraries.value,
    relationshipMembershipPolicies: libraries.value.map((library) => ({
      libraryId: library.id,
      includes: ({ relationship }) =>
        library.source ===
        `${API_LIBRARY_SOURCE_PREFIX}${relationship.remoteProject?.library_id}`,
    })),
  }))

  return {
    id: 'cloud-sync.api-project-libraries',
    provides: [provide(projectLibraryTypesValueSpec, contribution)],
    dispose: () => {
      disposed = true
      stop?.()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
    },
  }
}, 'cloud-sync.api-project-libraries')
