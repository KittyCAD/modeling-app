import { showShareProjectDialog } from '@src/components/ShareProjectDialog'
import type { App } from '@src/lib/app'
import type { Command } from '@src/lib/commandTypes'
import { isDesktop } from '@src/lib/isDesktop'
import { getProjectDisplayName } from '@src/lib/projectDisplayName'
import {
  duplicateViewOnlyProject,
  getCloudProjectPath,
  getDesktopProjectUrl,
  PROJECT_ACTION_COMMANDS,
} from '@src/lib/projectSharing'
import { reportRejection } from '@src/lib/trap'
import { platform } from '@src/lib/utils'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { FILE_COMMAND_SCOPES } from '@src/registry/contracts/commands'
import toast from 'react-hot-toast'

export function createProjectActionCommands(app: App): Command[] {
  const isViewOnly = () =>
    app.project?.projectIORefSignal.value.cloudSource?.canEdit === false
  const libraryOptions = () =>
    app.getCreateProjectLibraryTargets().map(({ library }) => ({
      name: library.title,
      value: library.id,
      isCurrent: false,
    }))

  const duplicate: Command = {
    ...PROJECT_ACTION_COMMANDS.duplicate,
    description: 'Duplicate the current project for editing.',
    icon: 'clone',
    needsReview: false,
    scopes: FILE_COMMAND_SCOPES,
    onSubmit: async (record) => {
      if (isViewOnly()) return duplicateViewOnlyProject(app, record?.libraryId)
      const project = app.project?.projectIORefSignal.value
      if (!project) return
      app.systemIOActor.send({
        type: SystemIOMachineEvents.duplicateProject,
        data: {
          projectName: project.name,
          projectPath: project.path,
          requestedProjectName: getProjectDisplayName(project),
          currentFilePath: app.project?.executingPath,
          currentFileContents: app.project?.executingEditor.value?.code,
        },
      })
    },
    args: {
      libraryId: {
        displayName: 'Library',
        inputType: 'options',
        required: () => isViewOnly() && libraryOptions().length > 1,
        hidden: () => !isViewOnly() || libraryOptions().length <= 1,
        prepopulate: true,
        options: libraryOptions,
        defaultValue: () => libraryOptions()[0]?.value ?? '',
      },
    },
  }

  const share: Command = {
    ...PROJECT_ACTION_COMMANDS.share,
    description: 'Share the current cloud project URL.',
    icon: 'share',
    needsReview: false,
    scopes: FILE_COMMAND_SCOPES,
    onSubmit: () => {
      const project = app.project?.projectIORefSignal.value
      const path =
        project && getCloudProjectPath(project, app.project?.executingPath)
      if (!path) return new Error('Open a cloud project to share its URL.')
      void showShareProjectDialog({
        url: new URL(path, window.location.origin).href,
      }).catch(reportRejection)
    },
  }

  const desktop: Command = {
    ...PROJECT_ACTION_COMMANDS.desktop,
    description: 'Open the current cloud project in the desktop app.',
    icon: 'exportFile',
    needsReview: false,
    scopes: FILE_COMMAND_SCOPES,
    onSubmit: () => {
      const project = app.project?.projectIORefSignal.value
      const url =
        project && getDesktopProjectUrl(project, app.project?.executingPath)
      if (!url)
        return new Error(
          'Open a cloud project before opening it in the desktop app.'
        )
      if (platform() === 'windows' && url.length > 2046) {
        toast.error(
          'The URL is too long to open in the desktop app on Windows. Use the web app.'
        )
        return
      }
      window.location.href = url
    },
  }

  return [duplicate, ...(!isDesktop() ? [share, desktop] : [])]
}
