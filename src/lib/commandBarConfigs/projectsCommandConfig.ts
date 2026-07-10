import { CommandBarOverwriteWarning } from '@src/components/CommandBarOverwriteWarning'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import fsZds from '@src/lib/fs-zds'
import { getHomeProjectDisplayName } from '@src/lib/homeProjects'
import { isDesktop } from '@src/lib/isDesktop'
import { PATHS, safeEncodeForRouterPaths } from '@src/lib/paths'
import type { commandBarMachine } from '@src/machines/commandBarMachine'
import type {
  HomeProjectEntry,
  HomeProjectEntryContribution,
} from '@src/registry/contracts/homeProjects'
import type { SystemIORegistryService } from '@src/registry/contracts/systemIO'
import type { ContextFrom } from 'xstate'

export type ProjectsCommandSchema = {
  'Import file from URL': {
    name: string
    code?: string
    method: 'newProject' | 'existingProject'
    projectName?: string
  }
}

function defaultEnableProjectDirectoryCommands() {
  return typeof window !== 'undefined' && Boolean(window.electron)
}

function projectWithId(
  project: HomeProjectEntryContribution
): HomeProjectEntry {
  return {
    ...project,
    id: project.id ?? project.localProjectPath ?? project.name,
  }
}

function navigateToFile(filePath: string) {
  const routerPath = `${PATHS.FILE}/${safeEncodeForRouterPaths(filePath)}`
  if (isDesktop()) {
    window.location.hash = routerPath
    return
  }
  window.history.pushState(null, '', routerPath)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function createProjectCommands({
  systemIO,
  getDefaultProjectName,
  getProjectDirectoryPath,
  enableProjectDirectoryCommands = defaultEnableProjectDirectoryCommands(),
}: {
  systemIO: SystemIORegistryService
  getDefaultProjectName: () => string
  getProjectDirectoryPath: () => string
  enableProjectDirectoryCommands?: boolean
}) {
  const projectEntriesSnapshot = () => systemIO.localProjectEntriesSignal.value

  const projectOptions = () => {
    const options: CommandArgumentOption<string>[] = []
    for (const project of projectEntriesSnapshot()) {
      if (!project.localProjectName) {
        continue
      }
      const displayName = getHomeProjectDisplayName(projectWithId(project))
      options.push({
        name:
          displayName === project.localProjectName
            ? displayName
            : `${displayName} (${project.localProjectName})`,
        value: project.localProjectName,
        isCurrent: false,
      })
    }
    return options
  }

  const projectPathForName = (name: string) => {
    const entry = projectEntriesSnapshot().find(
      (project) => project.localProjectName === name
    )
    return (
      entry?.localProjectPath || fsZds.join(getProjectDirectoryPath(), name)
    )
  }

  const openProjectByName = async (name: string) => {
    const project = await systemIO.request({
      type: 'project.loadTree',
      projectPath: projectPathForName(name),
    })
    navigateToFile(project.default_file)
  }

  const openProjectCommand: Command = {
    icon: 'folder',
    name: 'Open project',
    displayName: 'Open project',
    description: 'Open a project',
    groupId: 'projects',
    needsReview: false,
    onSubmit: (record) => {
      if (record) {
        void openProjectByName(record.name)
      }
    },
    args: {
      name: {
        required: true,
        inputType: 'options',
        options: projectOptions,
      },
    },
  }

  const createProjectCommand: Command = {
    icon: 'folder',
    name: 'Create project',
    displayName: 'Create project',
    description: 'Create a project',
    groupId: 'projects',
    needsReview: false,
    onSubmit: (record) => {
      if (record) {
        void systemIO.request({
          type: 'project.create',
          requestedProjectName: record.name,
        })
      }
    },
    args: {
      name: {
        required: true,
        inputType: 'string',
        defaultValue: getDefaultProjectName,
      },
    },
  }

  const deleteProjectCommand: Command = {
    icon: 'folder',
    name: 'Delete project',
    displayName: 'Delete project',
    description: 'Delete a project',
    groupId: 'projects',
    needsReview: true,
    onSubmit: (record) => {
      if (record) {
        void systemIO.request({
          type: 'project.delete',
          projectName: record.name,
        })
      }
    },
    reviewMessage: ({ argumentsToSubmit }) =>
      CommandBarOverwriteWarning({
        heading: 'Are you sure you want to delete?',
        message: `This will permanently delete the project "${argumentsToSubmit.name}" and all its contents.`,
      }),
    args: {
      name: {
        inputType: 'options',
        required: true,
        options: projectOptions,
      },
    },
  }

  const renameProjectCommand: Command = {
    icon: 'folder',
    name: 'Rename project',
    displayName: 'Rename project',
    description: 'Rename a project',
    groupId: 'projects',
    needsReview: true,
    onSubmit: (record) => {
      if (!record) {
        return
      }

      const hash = window.location.hash
      const pathname = hash ? hash.replace(/^#/, '') : window.location.pathname
      const isOnHomePage = pathname.startsWith(PATHS.HOME)
      void systemIO
        .request({
          type: 'project.rename',
          requestedProjectName: record.newName,
          projectName: record.oldName,
        })
        .then((result) => {
          if (!isOnHomePage) {
            void openProjectByName(result.newName)
          }
        })
    },
    args: {
      oldName: {
        inputType: 'options',
        required: true,
        options: projectOptions,
      },
      newName: {
        inputType: 'string',
        required: true,
        defaultValue: (context: ContextFrom<typeof commandBarMachine>) => {
          const oldName = context.argumentsToSubmit.oldName as
            | string
            | undefined
          const project = projectEntriesSnapshot().find(
            (item) => item.localProjectName === oldName
          )
          return project
            ? getHomeProjectDisplayName(projectWithId(project))
            : oldName || getDefaultProjectName()
        },
      },
    },
  }

  const importFileFromURL: Command = {
    name: 'Import file from URL',
    groupId: 'projects',
    icon: 'file',
    description: 'Create a file',
    needsReview: true,
    onSubmit: (record) => {
      if (record) {
        void systemIO
          .request({
            type: 'file.createKCL',
            requestedProjectName: record.projectName,
            requestedCode: record.code,
            requestedFileNameWithExtension: record.name,
          })
          .then((result) => {
            if (result.projectName && result.fileName) {
              navigateToFile(
                fsZds.join(
                  getProjectDirectoryPath(),
                  result.projectName,
                  result.fileName
                )
              )
            }
          })
      }
    },
    args: {
      method: {
        inputType: 'options',
        required: true,
        skip: true,
        options: isDesktop()
          ? [
              { name: 'New project', value: 'newProject' },
              { name: 'Existing project', value: 'existingProject' },
            ]
          : [{ name: 'Overwrite', value: 'existingProject' }],
        valueSummary(value) {
          return isDesktop()
            ? value === 'newProject'
              ? 'New project'
              : 'Existing project'
            : 'Overwrite'
        },
      },
      projectName: {
        inputType: 'options',
        required: (commandsContext) =>
          isDesktop() &&
          commandsContext.argumentsToSubmit.method === 'existingProject',
        skip: true,
        options: projectOptions,
      },
      name: {
        inputType: 'string',
        required: isDesktop(),
        skip: true,
      },
      code: {
        inputType: 'text',
        required: true,
        skip: true,
        valueSummary(value) {
          const lineCount = value?.trim().split('\n').length
          return `${lineCount} line${lineCount === 1 ? '' : 's'}`
        },
      },
    },
    reviewMessage(commandBarContext) {
      return isDesktop()
        ? `Will add the contents from URL to a new ${
            commandBarContext.argumentsToSubmit.method === 'newProject'
              ? 'project with file main.kcl'
              : `file within the project "${commandBarContext.argumentsToSubmit.projectName}"`
          } named "${
            commandBarContext.argumentsToSubmit.name
          }", and set default units to "${
            commandBarContext.argumentsToSubmit.units
          }".`
        : `Will overwrite the contents of the current file with the contents from the URL.`
    },
  }

  return enableProjectDirectoryCommands
    ? [
        openProjectCommand,
        createProjectCommand,
        deleteProjectCommand,
        renameProjectCommand,
        importFileFromURL,
      ]
    : [importFileFromURL]
}
