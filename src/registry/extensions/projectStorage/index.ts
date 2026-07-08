import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  NO_PROJECT_DIRECTORY,
  type SystemIOActor,
  SystemIOMachineEvents,
} from '@src/machines/systemIO/utils'
import {
  type NormalizedProjectStorageMutation,
  type ProjectStorageMutationInput,
  type ProjectStorageRegistryService,
  projectStorageService,
} from '@src/registry/contracts/projectStorage'

function normalizePath(path: string) {
  return path.replace(/\\/g, '/')
}

function getRelativeProjectPath(path: string, projectPath?: string) {
  if (!projectPath) {
    return undefined
  }

  const normalizedPath = normalizePath(path)
  const normalizedProjectPath = normalizePath(projectPath).replace(/\/+$/, '')
  if (normalizedPath === normalizedProjectPath) {
    return ''
  }

  const prefix = `${normalizedProjectPath}/`
  return normalizedPath.startsWith(prefix)
    ? normalizedPath.slice(prefix.length)
    : undefined
}

export const projectStorageExtension = defineRegistryItemFactory(() => {
  const actor = signal<SystemIOActor | undefined>(undefined)
  const projectDirectoryPath = signal(NO_PROJECT_DIRECTORY)
  const folders =
    signal<ProjectStorageRegistryService['folders']['value']>(undefined)
  const lastOperation =
    signal<ProjectStorageRegistryService['lastOperation']['value']>(undefined)
  const lastMutation = signal<NormalizedProjectStorageMutation | undefined>(
    undefined
  )
  let subscription: { unsubscribe: () => void } | undefined
  let mutationId = 0

  const syncActorSnapshot = (nextActor: SystemIOActor) => {
    const context = nextActor.getSnapshot().context
    projectDirectoryPath.value = context.projectDirectoryPath
    folders.value = context.folders
    lastOperation.value = context.lastOperation
  }

  const serviceImpl: ProjectStorageRegistryService = {
    actor,
    projectDirectoryPath,
    folders,
    lastOperation,
    lastMutation,
    connectActor: (nextActor) => {
      subscription?.unsubscribe()
      actor.value = nextActor
      syncActorSnapshot(nextActor)
      subscription = nextActor.subscribe(() => syncActorSnapshot(nextActor))

      return () => {
        if (actor.peek() !== nextActor) {
          return
        }

        subscription?.unsubscribe()
        subscription = undefined
        actor.value = undefined
      }
    },
    send: (...args: Parameters<SystemIOActor['send']>) => {
      actor.value?.send(...args)
    },
    refreshProjectDirectory: () => {
      actor.value?.send({
        type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
      })
    },
    recordMutation: (mutation: ProjectStorageMutationInput) => {
      const normalizedMutation: NormalizedProjectStorageMutation = {
        id: ++mutationId,
        kind: mutation.kind,
        path: normalizePath(mutation.path),
        previousPath: mutation.previousPath
          ? normalizePath(mutation.previousPath)
          : undefined,
        projectPath: mutation.projectPath
          ? normalizePath(mutation.projectPath)
          : undefined,
        relativePath: getRelativeProjectPath(
          mutation.path,
          mutation.projectPath
        ),
        source: mutation.source,
        at: new Date().toISOString(),
      }
      lastMutation.value = normalizedMutation
      return normalizedMutation
    },
    normalizePath,
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'project-storage-extension',
      providesServices: [provideService(projectStorageService, serviceImpl)],
      dispose: () => {
        subscription?.unsubscribe()
      },
    }),
  }
}, 'project-storage-extension')

export default defineRegistryItem({
  id: 'project-storage',
  uses: [projectStorageExtension],
})
