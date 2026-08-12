import {
  reportSystemIOError,
  type SystemIOErrorRisk,
} from '@src/machines/systemIO/errorReporting'
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

function operationFromErrorEvent(eventType: string) {
  return eventType.startsWith(XSTATE_ACTOR_ERROR_PREFIX)
    ? eventType.slice(XSTATE_ACTOR_ERROR_PREFIX.length)
    : eventType
}

function operationRisk(operation: string): SystemIOErrorRisk {
  const actor = operation as SystemIOMachineActors
  if (readOperations.has(actor)) {
    return 'read'
  }

  return destructiveOperations.has(actor) ? 'destructive' : 'write'
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

  reportSystemIOError({
    error: xstateEventError(event),
    operation,
    risk: operationRisk(operation),
    source: 'SystemIOMachine',
    eventType: event.type,
    extra: {
      hasProjectDirectory:
        context.projectDirectoryPath !== NO_PROJECT_DIRECTORY,
      hasListedProjects: context.hasListedProjects,
      projectCount: context.folders?.length,
    },
  })
}
