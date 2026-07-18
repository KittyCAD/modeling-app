import {
  reportSystemIOError,
  type SystemIOErrorMetadata,
  type SystemIOErrorRisk,
} from '@src/lib/systemIOErrorReporting'
import type { SystemIOContext } from '@src/machines/systemIO/utils'
import {
  NO_PROJECT_DIRECTORY,
  SystemIOMachineActors,
} from '@src/machines/systemIO/utils'
import { xstateEventError } from '@src/machines/utils'

const XSTATE_ACTOR_ERROR_PREFIX = 'xstate.error.actor.'

type OperationReportMetadata = SystemIOErrorMetadata & {
  risk: SystemIOErrorRisk
}

const operationReportMetadata: Partial<
  Record<SystemIOMachineActors, OperationReportMetadata>
> = {
  [SystemIOMachineActors.readFoldersFromProjectDirectory]: { risk: 'read' },
  [SystemIOMachineActors.checkReadWrite]: { risk: 'read' },
  [SystemIOMachineActors.createProject]: {
    risk: 'write',
    partialMutationPossible: true,
  },
  [SystemIOMachineActors.renameProject]: {
    risk: 'write',
    partialMutationPossible: true,
    dataLossPossible: true,
  },
  [SystemIOMachineActors.deleteProject]: {
    risk: 'destructive',
    partialMutationPossible: true,
    dataLossPossible: true,
  },
  [SystemIOMachineActors.createKCLFile]: {
    risk: 'write',
    partialMutationPossible: true,
  },
  [SystemIOMachineActors.importFileFromURL]: {
    risk: 'write',
    partialMutationPossible: true,
  },
  [SystemIOMachineActors.deleteKCLFile]: {
    risk: 'destructive',
    dataLossPossible: true,
  },
  [SystemIOMachineActors.bulkCreateKCLFiles]: {
    risk: 'write',
    partialMutationPossible: true,
  },
  [SystemIOMachineActors.bulkCreateKCLFilesAndNavigateToProject]: {
    risk: 'write',
    partialMutationPossible: true,
    dataLossPossible: true,
  },
  [SystemIOMachineActors.bulkImportProjectFilesAndNavigateToFile]: {
    risk: 'write',
    partialMutationPossible: true,
  },
  [SystemIOMachineActors.bulkCreateKCLFilesAndNavigateToFile]: {
    risk: 'write',
    partialMutationPossible: true,
    dataLossPossible: true,
  },
  [SystemIOMachineActors.bulkCreateAndDeleteKCLFilesAndNavigateToFile]: {
    risk: 'destructive',
    partialMutationPossible: true,
    dataLossPossible: true,
  },
  [SystemIOMachineActors.renameFolder]: {
    risk: 'destructive',
    partialMutationPossible: true,
    dataLossPossible: true,
  },
  [SystemIOMachineActors.renameFile]: {
    risk: 'destructive',
    partialMutationPossible: true,
    dataLossPossible: true,
  },
  [SystemIOMachineActors.renameFileAndNavigateToFile]: {
    risk: 'destructive',
    partialMutationPossible: true,
    dataLossPossible: true,
  },
  [SystemIOMachineActors.renameFolderAndNavigateToFile]: {
    risk: 'destructive',
    partialMutationPossible: true,
    dataLossPossible: true,
  },
  [SystemIOMachineActors.deleteFileOrFolder]: {
    risk: 'destructive',
    partialMutationPossible: true,
    dataLossPossible: true,
  },
  [SystemIOMachineActors.deleteFileOrFolderAndNavigate]: {
    risk: 'destructive',
    partialMutationPossible: true,
    dataLossPossible: true,
  },
  [SystemIOMachineActors.createBlankFile]: {
    risk: 'write',
    partialMutationPossible: true,
  },
  [SystemIOMachineActors.createBlankFolder]: { risk: 'write' },
  [SystemIOMachineActors.copyRecursive]: {
    risk: 'write',
    partialMutationPossible: true,
    dataLossPossible: true,
  },
  [SystemIOMachineActors.moveRecursive]: {
    risk: 'destructive',
    partialMutationPossible: true,
    dataLossPossible: true,
  },
  [SystemIOMachineActors.moveRecursiveAndNavigate]: {
    risk: 'destructive',
    partialMutationPossible: true,
    dataLossPossible: true,
  },
}

function operationFromErrorEvent(eventType: string) {
  return eventType.startsWith(XSTATE_ACTOR_ERROR_PREFIX)
    ? eventType.slice(XSTATE_ACTOR_ERROR_PREFIX.length)
    : eventType
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
  const metadata = operationReportMetadata[
    operation as SystemIOMachineActors
  ] ?? {
    risk: 'write' as const,
  }
  const { risk, ...operationMetadata } = metadata

  reportSystemIOError({
    error: xstateEventError(event),
    operation,
    risk,
    source: 'SystemIOMachine',
    eventType: event.type,
    extra: {
      ...operationMetadata,
      hasProjectDirectory:
        context.projectDirectoryPath !== NO_PROJECT_DIRECTORY,
      hasListedProjects: context.hasListedProjects,
      projectCount: context.folders?.length,
    },
  })
}
