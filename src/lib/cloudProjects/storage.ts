import { computed } from '@preact/signals-core'
import type { ReadonlySignal } from '@preact/signals-core'
import type { CloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import type {
  ProjectStorage,
  ProjectWriteAvailability,
} from '@src/lib/projectSession/storage'
import { getContainedRelativePath } from '@src/lib/fileSystem/pathContainment'
import type { IZooDesignStudioFS } from '@src/lib/fs-zds/interface'

/** Resolves cloud paths once and keeps all operations bound to that project's identity. */
export function createCloudProjectStorageProvider(
  cloud: CloudStorageService,
  paths: Pick<IZooDesignStudioFS, 'resolve' | 'relative' | 'sep' | 'join'>,
  offline: ReadonlySignal<boolean>
) {
  const bindings = new Map<string, ProjectStorage>()
  const writeAvailability = computed<ProjectWriteAvailability>(() =>
    offline.value
      ? { writable: false, reason: 'Offline. Cloud project is read-only.' }
      : { writable: true }
  )
  return (path: string): ProjectStorage | undefined => {
    if (
      getContainedRelativePath(paths, cloud.root, path) === undefined ||
      paths.resolve(path) === paths.resolve(cloud.root)
    )
      return
    const id = cloud.idFor(path)
    const root = paths.join(cloud.root, id)
    const existing = bindings.get(id)
    if (existing) return existing
    const binding: ProjectStorage = {
      root,
      writeAvailability,
      saveState: computed(() => cloud.saves.value.get(id)),
      externalChanges: 'snapshot',
      deletionHistory: 'storage',
      createMissingEntrypoint: false,
      watch: (path, _key, onEvent) =>
        cloud.subscribe((changes) => {
          for (const change of changes)
            if (
              getContainedRelativePath(paths, path, change.path) !== undefined
            )
              onEvent(change.eventType, change.path)
        }),
      batch: (path, run) => cloud.batch(path, run),
      refresh: async (isCurrent, revision) => {
        await cloud.refreshProject(id, isCurrent, revision)
      },
      retry: () => cloud.retry(id),
      editorChanged: (path) => cloud.editorChanged(path),
      writeThumbnail: (bytes) => cloud.stageThumbnail(root, bytes),
    }
    bindings.set(id, binding)
    return binding
  }
}
