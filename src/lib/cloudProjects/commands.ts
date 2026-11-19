import type { ProjectLibraryScope, UserOrgInfo } from '@kittycad/lib'
import { CloudApiError } from '@src/lib/cloudProjects/runtime/api'
import type { Command } from '@src/lib/commandTypes'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'
import toast from 'react-hot-toast'
import type { AnyStateMachine } from 'xstate'

export const CREATE_CLOUD_LIBRARY_COMMAND = 'Create cloud library'

export function createCloudProjectCommands({
  enabled,
  organization,
  createLibrary,
}: {
  enabled: () => boolean
  organization: () => Pick<UserOrgInfo, 'name'> | undefined
  createLibrary: (name: string, scope: ProjectLibraryScope) => Promise<unknown>
}): Command[] {
  const create: Command<
    AnyStateMachine,
    typeof CREATE_CLOUD_LIBRARY_COMMAND,
    { name?: string; scope?: ProjectLibraryScope }
  > = {
    name: CREATE_CLOUD_LIBRARY_COMMAND,
    groupId: 'projects',
    scopes: GLOBAL_COMMAND_SCOPES,
    icon: 'folderPlus',
    disabled: !enabled(),
    needsReview: true,
    args: {
      name: {
        displayName: 'Library name',
        inputType: 'string',
        required: true,
        validation: async ({ data }) => {
          const name = String(data.name ?? '').trim()
          return (
            (name.length >= 1 && name.length <= 255) ||
            'Enter a library name between 1 and 255 characters.'
          )
        },
      },
      scope: {
        displayName: 'Owner',
        inputType: 'options',
        required: true,
        defaultValue: 'personal',
        prepopulate: true,
        hidden: () => !organization(),
        options: () => [
          { name: 'Personal', value: 'personal' as const, isCurrent: false },
          ...(organization()
            ? [
                {
                  name: organization()?.name ?? 'Organization',
                  value: 'organization' as const,
                  isCurrent: false,
                },
              ]
            : []),
        ],
      },
    },
    onSubmit: async (data) => {
      const name = data?.name?.trim() ?? ''
      const scope = data?.scope ?? 'personal'
      if (!enabled() || !name || name.length > 255)
        return Promise.reject(
          new Error('Enter a valid library name while signed in and online.')
        )
      try {
        await createLibrary(name, scope)
      } catch (error) {
        if (error instanceof CloudApiError && error.status === 403) return error
        return Promise.reject(error)
      }
      toast.success(`Created library "${name}".`)
    },
  }
  return [create]
}
