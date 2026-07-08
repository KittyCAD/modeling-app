import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { Project } from '@src/lib/project'
import type {
  SystemIOActor,
  SystemIOContext,
} from '@src/machines/systemIO/utils'

export type ProjectStorageMutationKind =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'renamed'

export type ProjectStorageMutationInput = {
  kind: ProjectStorageMutationKind
  path: string
  previousPath?: string
  projectPath?: string
  source?: string
}

export type NormalizedProjectStorageMutation = {
  id: number
  kind: ProjectStorageMutationKind
  path: string
  previousPath?: string
  projectPath?: string
  relativePath?: string
  source?: string
  at: string
}

export type ProjectStorageRegistryService = {
  actor: ReadonlySignal<SystemIOActor | undefined>
  projectDirectoryPath: ReadonlySignal<string>
  folders: ReadonlySignal<readonly Project[] | undefined>
  lastOperation: ReadonlySignal<SystemIOContext['lastOperation']>
  lastMutation: ReadonlySignal<NormalizedProjectStorageMutation | undefined>
  connectActor: (actor: SystemIOActor) => () => void
  send: SystemIOActor['send']
  refreshProjectDirectory: () => void
  recordMutation: (
    mutation: ProjectStorageMutationInput
  ) => NormalizedProjectStorageMutation
  normalizePath: (path: string) => string
}

export const projectStorageContract = defineContract({
  projectStorageService: defineService<ProjectStorageRegistryService>(
    'project-storage.service'
  ),
})

export const { projectStorageService } = projectStorageContract
