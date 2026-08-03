import {
  reportSystemIOError,
  type SystemIOErrorRisk,
} from '@src/lib/systemIOErrorReporting'
import type { SystemIOContext } from '@src/machines/systemIO/utils'
import {
  NO_PROJECT_DIRECTORY,
  SystemIOMachineActors,
} from '@src/machines/systemIO/utils'
import { xstateEventError } from '@src/machines/utils'

const XSTATE_ACTOR_ERROR_PREFIX = 'xstate.error.actor.'

const readOperations = new Set<SystemIOMachineActors>([
  SystemIOMachineActors.readFoldersFromProjectDirectory,
  SystemIOMachineActors.checkReadWrite,
])

const destructiveOperations = new Set<SystemIOMachineActors>([
  SystemIOMachineActors.deleteProject,
  SystemIOMachineActors.deleteKCLFile,
  SystemIOMachineActors.bulkCreateAndDeleteKCLFilesAndNavigateToFile,
  SystemIOMachineActors.renameFolder,
  SystemIOMachineActors.renameFile,
  SystemIOMachineActors.renameFileAndNavigateToFile,
  SystemIOMachineActors.renameFolderAndNavigateToFile,
  SystemIOMachineActors.deleteFileOrFolder,
  SystemIOMachineActors.deleteFileOrFolderAndNavigate,
  SystemIOMachineActors.moveRecursive,
  SystemIOMachineActors.moveRecursiveAndNavigate,
])

const dataLossWriteOperations = new Set<SystemIOMachineActors>([
  SystemIOMachineActors.renameProject,
  SystemIOMachineActors.bulkCreateKCLFilesAndNavigateToProject,
  SystemIOMachineActors.bulkCreateKCLFilesAndNavigateToFile,
  SystemIOMachineActors.copyRecursive,
])

function operationFromErrorEvent(eventType: string) {
  return eventType.startsWith(XSTATE_ACTOR_ERROR_PREFIX)
    ? eventType.slice(XSTATE_ACTOR_ERROR_PREFIX.length)
    : eventType
}

function operationMetadata(operation: string): {
  risk: SystemIOErrorRisk
  partialMutationPossible?: boolean
  dataLossPossible?: boolean
} {
  const actor = operation as SystemIOMachineActors
  if (readOperations.has(actor)) {
    return { risk: 'read' }
  }

  const destructive = destructiveOperations.has(actor)
  return {
    risk: destructive ? 'destructive' : 'write',
    partialMutationPossible: true,
    ...(destructive || dataLossWriteOperations.has(actor)
      ? { dataLossPossible: true }
      : {}),
  }
}

export function reportSystemIOMachineError({
  context,
  event,
}: {
  context: SystemIOContext
  event: {
    type: string
    error?: unknown
    output?: unknown
    data?: unknown
  }
}) {
  const operation = operationFromErrorEvent(event.type)
  const { risk, ...extra } = operationMetadata(operation)

  reportSystemIOError({
    error: xstateEventError(event),
    operation,
    risk,
    source: 'SystemIOMachine',
    eventType: event.type,
    extra: {
      ...extra,
      hasProjectDirectory:
        context.projectDirectoryPath !== NO_PROJECT_DIRECTORY,
      hasListedProjects: context.hasListedProjects,
      projectCount: context.folders?.length,
    },
  })
}
