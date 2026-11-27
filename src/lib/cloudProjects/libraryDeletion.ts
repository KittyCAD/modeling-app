import type { ProjectLibraryResponse } from '@kittycad/lib'
import { formatCloudLibraryLabel } from '@src/lib/cloudProjects/apiProjectLibraries'
import type { RemoteProjectSummary } from '@src/lib/cloudProjects/runtime/types'
import type { Command } from '@src/lib/commandTypes'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'
import toast from 'react-hot-toast'
import type { AnyStateMachine } from 'xstate'

export const DELETE_CLOUD_LIBRARY_COMMAND = 'Delete cloud library'

export type RemoteProjectLibrary = Pick<ProjectLibraryResponse, 'id' | 'name'> &
  Partial<
    Pick<
      ProjectLibraryResponse,
      'can_manage' | 'source' | 'org_id' | 'revision'
    >
  >

export function canDeleteCloudLibrary(
  library: RemoteProjectLibrary,
  projects: readonly RemoteProjectSummary[]
) {
  return Boolean(
    library.can_manage === true &&
      library.revision &&
      library.source !== 'org_dataset' &&
      library.source !== 'factory_portal' &&
      !projects.some((project) => project.library_id === library.id)
  )
}

export function createCloudLibraryDeleteCommand({
  enabled,
  libraries,
  projects,
  deleteLibrary,
}: {
  enabled: () => boolean
  libraries: () => readonly RemoteProjectLibrary[]
  projects: () => readonly RemoteProjectSummary[]
  deleteLibrary: (id: string, revision: string) => Promise<void>
}): Command {
  const deletableLibraries = () =>
    libraries().filter((library) => canDeleteCloudLibrary(library, projects()))
  const libraryLabel = (id: unknown) => {
    const library = libraries().find((library) => library.id === id)
    return library
      ? formatCloudLibraryLabel(library.name, library.org_id)
      : 'Unavailable library'
  }
  const command: Command<
    AnyStateMachine,
    typeof DELETE_CLOUD_LIBRARY_COMMAND,
    { library?: string }
  > = {
    name: DELETE_CLOUD_LIBRARY_COMMAND,
    groupId: 'projects',
    scopes: GLOBAL_COMMAND_SCOPES,
    icon: 'trash',
    disabled: !enabled() || deletableLibraries().length === 0,
    needsReview: true,
    reviewMessage: ({ argumentsToSubmit }) =>
      `Delete the empty cloud library "${libraryLabel(argumentsToSubmit.library)}"? This cannot be undone.`,
    args: {
      library: {
        displayName: 'Library',
        inputType: 'options',
        required: true,
        skip: true,
        valueSummary: libraryLabel,
        options: () =>
          deletableLibraries().map((library) => ({
            name: formatCloudLibraryLabel(library.name, library.org_id),
            value: library.id,
            isCurrent: false,
          })),
      },
    },
    onSubmit: async (data) => {
      const library = deletableLibraries().find(
        (library) => library.id === data?.library
      )
      if (!enabled() || !library?.revision)
        return Promise.reject(
          new Error(
            'Only empty cloud libraries you can manage can be deleted. Refresh libraries and try again.'
          )
        )
      await deleteLibrary(library.id, library.revision)
      toast.success(`Deleted library "${library.name}".`)
    },
  }
  return command
}
