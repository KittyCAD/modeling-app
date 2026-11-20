import type { UserOrgInfo } from '@kittycad/lib'
import type { Command } from '@src/lib/commandTypes'
import { getHomeProjectDisplayName } from '@src/lib/homeProjects'
import { GLOBAL_COMMAND_SCOPES } from '@src/registry/contracts/commands'
import type { HomeProjectEntry } from '@src/registry/contracts/homeProjects'
import toast from 'react-hot-toast'
import type { AnyStateMachine } from 'xstate'

export const SHARE_PROJECT_WITH_ORGANIZATION_COMMAND =
  'Share project with organization'

export function createOrganizationSharingCommand({
  enabled,
  organization,
  projects,
  shareProject,
}: {
  enabled: () => boolean
  organization: () => Pick<UserOrgInfo, 'name'> | undefined
  projects: () => readonly HomeProjectEntry[]
  shareProject: (id: string) => Promise<unknown>
}): Command {
  const shareableProjects = () =>
    projects().filter((project) => project.canShareWithOrganization)
  const command: Command<
    AnyStateMachine,
    typeof SHARE_PROJECT_WITH_ORGANIZATION_COMMAND,
    { project?: string }
  > = {
    name: SHARE_PROJECT_WITH_ORGANIZATION_COMMAND,
    groupId: 'projects',
    scopes: GLOBAL_COMMAND_SCOPES,
    icon: 'share',
    disabled: !enabled() || !organization() || shareableProjects().length === 0,
    needsReview: true,
    reviewMessage: () =>
      `This transfers the project to ${organization()?.name ?? 'your organization'}, making it available to its members. Its files and history are preserved.`,
    args: {
      project: {
        displayName: 'Project',
        inputType: 'options',
        required: true,
        options: () =>
          shareableProjects().map((project) => ({
            name: getHomeProjectDisplayName(project),
            value: project.id,
            isCurrent: false,
          })),
      },
    },
    onSubmit: async (data) => {
      const project = shareableProjects().find(
        (project) => project.id === data?.project
      )
      if (!enabled() || !organization() || !project?.remoteProjectId)
        return Promise.reject(
          new Error('This project cannot be shared with your organization.')
        )
      await shareProject(project.remoteProjectId)
      toast.success(
        `Shared "${getHomeProjectDisplayName(project)}" with your organization.`
      )
    },
  }
  return command
}
