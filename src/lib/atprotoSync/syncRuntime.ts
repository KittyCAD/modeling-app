import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
} from '@kittycad/registry'
import { effect } from '@preact/signals-core'
import { uploadAtprotoLocalProject } from '@src/lib/atprotoSync/localSync'
import {
  type AtprotoOAuthConnector,
  isAtprotoOAuthIdentity,
  isAtprotoSyncIdentity,
} from '@src/lib/atprotoSync/oauth'
import { getAtprotoProjectLibraryMaterializationDirectoryPath } from '@src/lib/atprotoSync/projectLibrary'
import {
  addCloudSyncFileSystemMutationListener,
  getCloudSyncProjectRootInDirectories,
} from '@src/lib/cloudSync'
import {
  isCloudSyncExcludedPath,
  normalizePathForSync,
} from '@src/lib/cloudSync/paths'
import {
  type ProjectLibrary,
  type ProjectLibrarySetting,
  projectLibrariesFromSettings,
} from '@src/lib/projectLibraries'
import { reportRejection } from '@src/lib/trap'
import { settingsService } from '@src/registry/contracts/settings'

export { uploadAtprotoLocalProject }

const ATPROTO_SYNC_DEBOUNCE_MS = 2500
const ATPROTO_PROJECT_LIBRARY_TYPE = 'atproto'

function getAtprotoIdentityFromSettings(value: unknown) {
  const candidate = (
    value as
      | {
          auth?: {
            atproto?: {
              current?: unknown
            }
          }
        }
      | undefined
  )?.auth?.atproto?.current

  return isAtprotoOAuthIdentity(candidate) ? candidate : undefined
}

function getAtprotoLibraries(settings: unknown) {
  const librarySettings = (
    settings as
      | {
          app?: {
            libraries?: {
              current?: unknown
            }
          }
        }
      | undefined
  )?.app?.libraries?.current

  if (!Array.isArray(librarySettings)) {
    return []
  }

  return projectLibrariesFromSettings(
    librarySettings as readonly ProjectLibrarySetting[]
  ).filter((library) => library.type === ATPROTO_PROJECT_LIBRARY_TYPE)
}

async function getAtprotoMaterializationDirectories(
  libraries: ProjectLibrary[]
) {
  const directories = await Promise.all(
    libraries.map((library) =>
      Promise.resolve(
        getAtprotoProjectLibraryMaterializationDirectoryPath(library)
      )
    )
  )

  return Array.from(
    new Set(
      directories
        .map((directory) => directory.trim())
        .filter(Boolean)
        .map(normalizePathForSync)
    )
  )
}

function projectRootForMutation(
  targetPath: string,
  materializationDirectories: readonly string[]
) {
  return getCloudSyncProjectRootInDirectories(
    targetPath,
    materializationDirectories
  )
}

export function createAtprotoSyncRuntime({
  connector,
}: {
  connector: AtprotoOAuthConnector
}) {
  return defineRegistryItemFactory((ctx) => {
    const settings = ctx.services.signal(settingsService)
    const pendingProjectTimers = new Map<
      string,
      ReturnType<typeof setTimeout>
    >()
    let disposed = false
    let materializationDirectories: string[] = []
    let disposeMutationListener: (() => void) | undefined
    let disposeSettingsEffect: (() => void) | undefined
    let directoryGeneration = 0

    const getIdentity = () => {
      const identity = getAtprotoIdentityFromSettings(settings.value?.get())
      return identity && isAtprotoSyncIdentity(identity) ? identity : undefined
    }

    const scheduleUpload = (projectRoot: string) => {
      if (disposed || !getIdentity()) {
        return
      }

      const normalizedProjectRoot = normalizePathForSync(projectRoot)
      const existingTimer = pendingProjectTimers.get(normalizedProjectRoot)
      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      pendingProjectTimers.set(
        normalizedProjectRoot,
        setTimeout(() => {
          pendingProjectTimers.delete(normalizedProjectRoot)
          const identity = getIdentity()
          if (!identity || disposed) {
            return
          }

          void uploadAtprotoLocalProject({
            connector,
            identity,
            projectRoot: normalizedProjectRoot,
          }).catch(reportRejection)
        }, ATPROTO_SYNC_DEBOUNCE_MS)
      )
    }

    const handleWriteLike = (targetPath: string) => {
      if (isCloudSyncExcludedPath(targetPath)) {
        return
      }

      const projectRoot = projectRootForMutation(
        targetPath,
        materializationDirectories
      )
      if (projectRoot) {
        scheduleUpload(projectRoot)
      }
    }

    const handleRename = (sourcePath: string, targetPath: string) => {
      handleWriteLike(targetPath)
      handleWriteLike(sourcePath)
    }

    const refreshDirectories = () => {
      const generation = ++directoryGeneration
      const currentSettings = settings.value?.current.value
      const identity = getIdentity()
      if (!identity) {
        materializationDirectories = []
        return
      }

      void getAtprotoMaterializationDirectories(
        getAtprotoLibraries(currentSettings)
      )
        .then((directories) => {
          if (!disposed && generation === directoryGeneration) {
            materializationDirectories = directories
          }
        })
        .catch(reportRejection)
    }

    disposeMutationListener = addCloudSyncFileSystemMutationListener({
      writeLike: handleWriteLike,
      remove: handleWriteLike,
      rename: handleRename,
    })

    queueMicrotask(() => {
      if (disposed) {
        return
      }

      disposeSettingsEffect = effect(() => {
        settings.value?.current.value
        getIdentity()
        refreshDirectories()
      })
    })

    return {
      item: defineRuntimeRegistryItem({
        id: 'atproto-sync-runtime',
        dispose: () => {
          disposed = true
          directoryGeneration += 1
          disposeSettingsEffect?.()
          disposeMutationListener?.()
          for (const timer of pendingProjectTimers.values()) {
            clearTimeout(timer)
          }
          pendingProjectTimers.clear()
        },
      }),
    }
  }, 'atproto-sync-runtime')
}
