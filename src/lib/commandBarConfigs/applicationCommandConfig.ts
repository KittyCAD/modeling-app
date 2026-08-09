import env from '@src/env'
import { relevantFileExtensions } from '@src/lang/wasmUtils'
import type { App } from '@src/lib/app'
import type { Command } from '@src/lib/commandTypes'
import {
  writeEnvironmentConfigurationKittycadWebSocketUrl,
  writeEnvironmentConfigurationZookeeperWebSocketUrl,
  writeEnvironmentFile,
} from '@src/lib/desktop'
import { getNextFileName, getUniqueProjectName } from '@src/lib/desktopFS'
import { exportProjectZip } from '@src/lib/exportProjectZip'
import fsZds from '@src/lib/fs-zds'
import { isDesktop } from '@src/lib/isDesktop'
import {
  downloadKclSample,
  everyKclSample,
  findKclSample,
} from '@src/lib/kclSamples'
import { isUserLoadableLayoutKey, userLoadableLayouts } from '@src/lib/layout'
import {
  getEXTNoPeriod,
  getStringAfterLastSeparator,
  joinOSPaths,
  webSafePathSplit,
} from '@src/lib/paths'
import { getHomeProjectDisplayName } from '@src/lib/homeProjects'
import type { FileEntry } from '@src/lib/project'
import {
  navigateToProject,
  navigateToProjectFile,
} from '@src/lib/projectSessionNavigation'
import { reportRejection } from '@src/lib/trap'
import { isArray, returnSelfOrGetHostNameFromURL } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { CommandBarActorType } from '@src/machines/commandBarMachine'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import { getAllSubDirectoriesAtProjectRoot } from '@src/lib/projectTree'
import type { RequestedKCLFile } from '@src/lib/projectFiles'
import { homeProjectEntriesValueSpec } from '@src/registry/contracts/homeProjects'
import { projectSession } from '@src/registry/contracts/projectSession'
import toast from 'react-hot-toast'
import { waitFor } from 'xstate'

const ADD_FILE_TO_PROJECT_COMMAND = {
  name: 'add-kcl-file-to-project',
  groupId: 'application',
} as const

function getHomeProjectFileEntries(app: App): FileEntry[] {
  return app.registry.get(homeProjectEntriesValueSpec).flatMap((project) => {
    const name = project.localProjectName ?? project.name
    const path = project.localProjectPath ?? name
    if (!name || !path) {
      return []
    }

    return [
      {
        name,
        path,
        children: [],
      },
    ]
  })
}

function findHomeProjectEntryForCommandValue(app: App, value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  return app.registry
    .get(homeProjectEntriesValueSpec)
    .find(
      (project) =>
        project.id === value ||
        project.localProjectName === value ||
        project.localProjectPath === value ||
        project.name === value
    )
}

function getHomeProjectOptions(app: App) {
  const currentProject = app.registry.get(projectSession).getProject()
  const currentProjectName = currentProject?.name

  const projects = app.registry.get(homeProjectEntriesValueSpec)
  const options = projects.map((project) => ({
    name: getHomeProjectDisplayName(project),
    value: project.id,
    isCurrent:
      project.name === currentProjectName ||
      project.localProjectName === currentProjectName,
  }))
  const currentProjectHasOption = projects.some(
    (project) =>
      project.localProjectPath === currentProject?.path ||
      project.localProjectName === currentProject?.name ||
      project.name === currentProject?.name
  )

  if (currentProject && !currentProjectHasOption) {
    options.push({
      name: currentProject.name,
      value: currentProject.name,
      isCurrent: true,
    })
  }

  return options
}

function onSubmitKCLSampleCreation({
  app,
  sample,
  uniqueNameIfNeeded,
  isProjectNew,
}: {
  app: App
  sample: string
  uniqueNameIfNeeded: string
  isProjectNew: boolean
}) {
  void downloadKclSample(sample, {
    assetUrlPrefix: isDesktop() ? '.' : '',
  })
    .then(async ({ requestedProjectName: projectPathPart, initialProject }) => {
      const requestedFiles: RequestedKCLFile[] = initialProject.files.map(
        (file) => ({
          requestedCode: new TextDecoder().decode(file.requestedData),
          requestedFileName: file.requestedFileName,
          requestedProjectName: uniqueNameIfNeeded,
        })
      )

      /**
       * When adding assemblies to an existing project create the assembly into a unique sub directory
       */
      if (!isProjectNew) {
        requestedFiles.forEach((requestedFile) => {
          const subDirectoryName = projectPathPart
          const projectTree = app.registry.get(projectSession).getProjectTree()
          const firstLevelDirectories = getAllSubDirectoriesAtProjectRoot(
            { folders: projectTree ? [projectTree] : [] },
            { projectFolderName: requestedFile.requestedProjectName }
          )
          const uniqueSubDirectoryName = getUniqueProjectName(
            subDirectoryName,
            firstLevelDirectories
          )
          requestedFile.requestedProjectName = joinOSPaths(
            requestedFile.requestedProjectName,
            uniqueSubDirectoryName
          )
        })
      }

      const session = app.registry.get(projectSession)
      const result = await session.createKclFiles({
        files: requestedFiles,
        requestedProjectName: uniqueNameIfNeeded,
      })
      toast.success(result.message)

      if (requestedFiles.length === 1 && result.filePath) {
        await navigateToProjectFile({
          app,
          filePath: result.filePath,
        })
      } else {
        navigateToProject({
          app,
          projectPath: result.projectRoot,
        })
      }
    })
    .catch(reportError)
}

export function createApplicationCommands({
  app,
  wasmInstance,
}: {
  app: App
  wasmInstance: ModuleType
}) {
  const addKCLFileToProject: Command = {
    name: 'add-kcl-file-to-project',
    displayName: 'Add file to project',
    description:
      'Add KCL file, Zoo sample, or 3D model to new or existing project.',
    needsReview: false,
    icon: 'importFile',
    groupId: 'application',
    onSubmit(data) {
      if (data) {
        /**
         * TODO: Move imported model handling into a domain service. This command
         * currently handles KCL samples and model files directly through project
         * session operations.
         */
        const error = "The command couldn't be submitted, check the arguments."
        const session = app.registry.get(projectSession)
        const folders = getHomeProjectFileEntries(app)
        const isProjectNew = !!data.newProjectName
        const existingProject = findHomeProjectEntryForCommandValue(
          app,
          data.projectName
        )
        const requestedProjectName =
          data.newProjectName ||
          existingProject?.localProjectName ||
          existingProject?.name ||
          data.projectName
        const uniqueNameIfNeeded = isProjectNew
          ? getUniqueProjectName(requestedProjectName, folders)
          : requestedProjectName

        if (data.source === 'kcl-samples') {
          const kclSample = findKclSample(data.sample)
          if (!kclSample || kclSample.files.length === 0) {
            toast.error("Couldn't find KCL sample.")
          } else {
            onSubmitKCLSampleCreation({
              app,
              sample: data.sample,
              uniqueNameIfNeeded,
              isProjectNew,
            })
          }
        } else if (data.source === 'local') {
          const selectedFilePath = isArray(data.files)
            ? data.files[0]
            : data.files

          if (!selectedFilePath) {
            toast.error(error)
            return
          }

          const fileNameWithExtension =
            getStringAfterLastSeparator(selectedFilePath)
          const fr = new FileReader()
          const extension = getEXTNoPeriod(selectedFilePath)
          const isKCL = extension === 'kcl'
          fr.addEventListener('load', () => {
            if (isKCL) {
              if (typeof fr.result !== 'string') {
                toast.error(error)
                return
              }

              session
                .createKclFiles({
                  requestedProjectName: uniqueNameIfNeeded,
                  files: [
                    {
                      requestedProjectName: uniqueNameIfNeeded,
                      requestedFileName: fileNameWithExtension,
                      requestedCode: fr.result,
                    },
                  ],
                })
                .then(async (result) => {
                  toast.success(result.message)
                  if (result.filePath) {
                    await navigateToProjectFile({
                      app,
                      filePath: result.filePath,
                    })
                  }
                })
                .catch(() => toast.error(error))
            } else {
              if (!(fr.result instanceof ArrayBuffer)) {
                toast.error(error)
                return
              }

              const fileData = new Uint8Array(fr.result)

              session
                .getDefaultProjectDirectoryPath()
                .then((projectDirectoryPath) =>
                  getNextFileName({
                    entryName: fileNameWithExtension,
                    baseDir: joinOSPaths(
                      projectDirectoryPath,
                      uniqueNameIfNeeded
                    ),
                    wasmInstance,
                    preserveUnknownExtension: true,
                  })
                )
                .then(({ path }) => {
                  return session.writeFileAtPath({
                    path,
                    contents: fileData,
                  })
                })
                .then((path) => {
                  toast.success(`Successfully imported ${fsZds.basename(path)}`)
                })
                .catch(() => toast.error(error))
            }
          })
          fsZds
            .readFile(selectedFilePath)
            .then((content) => {
              const blob = new Blob([new Uint8Array(content)])
              // Read all KCL as text, but anything else is a blob.
              if (isKCL) {
                fr.readAsText(blob)
              } else {
                fr.readAsArrayBuffer(blob)
              }
            })
            .catch(() => toast.error(error))
        } else {
          toast.error(error)
        }
      }
    },
    args: {
      source: {
        inputType: 'options',
        required: true,
        skip: true,
        defaultValue: window.electron ? undefined : 'kcl-samples',
        options() {
          return [
            ...(window.electron
              ? [
                  {
                    value: 'local',
                    name: 'Local Drive',
                    isCurrent: false,
                  },
                ]
              : []),
            {
              value: 'kcl-samples',
              name: 'KCL Samples',
              isCurrent: true,
            },
          ]
        },
      },
      sample: {
        inputType: 'options',
        required: (commandContext) =>
          !['local'].includes(
            commandContext.argumentsToSubmit.source as string
          ),
        hidden: (commandContext) =>
          ['local'].includes(commandContext.argumentsToSubmit.source as string),
        valueSummary(value) {
          const MAX_LENGTH = 12
          if (typeof value === 'string') {
            return value.length > MAX_LENGTH
              ? `${value.substring(0, MAX_LENGTH)}...`
              : value
          }
          return value
        },
        options: () => {
          const samples = everyKclSample
          return samples.map((sample) => {
            return {
              value: sample.pathFromProjectDirectoryToFirstFile,
              name: sample.title,
            }
          })
        },
      },
      method: {
        inputType: 'options',
        required: true,
        skip: true,
        defaultValue: window.electron ? undefined : 'existingProject',
        options: window.electron
          ? [
              { name: 'New project', value: 'newProject', isCurrent: true },
              { name: 'Existing project', value: 'existingProject' },
            ]
          : [{ name: 'Existing project', value: 'existingProject' }],
        valueSummary(value) {
          return value === 'newProject' ? 'New project' : 'Existing project'
        },
      },
      projectName: {
        inputType: 'options',
        required: (commandsContext) =>
          commandsContext.argumentsToSubmit.method === 'existingProject',
        skip: true,
        defaultValue: () =>
          findHomeProjectEntryForCommandValue(
            app,
            app.registry.get(projectSession).getProject()?.path
          )?.id ?? app.registry.get(projectSession).getProject()?.name,
        options: () => getHomeProjectOptions(app),
      },
      newProjectName: {
        inputType: 'string',
        required: (commandsContext) =>
          commandsContext.argumentsToSubmit.method === 'newProject',
        skip: true,
      },
      files: {
        inputType: 'path',
        skip: true,
        hidden: false,
        valueSummary: (value) => {
          if (typeof value === 'string') {
            return fsZds.basename(value)
          }
          if (isArray(value) && typeof value[0] === 'string') {
            return fsZds.basename(value[0])
          }
          return value
        },
        required: (commandContext) =>
          ['local'].includes(commandContext.argumentsToSubmit.source as string),
        filters: [
          {
            name: `Import ${relevantFileExtensions(wasmInstance).map((f) => ` .${f}`)}`,
            extensions: relevantFileExtensions(wasmInstance),
          },
          {
            name: 'All files',
            extensions: ['*'],
          },
        ],
      },
    },
  }

  /**
   * Looks similar to Add file to project but more data is hard coded for the home page button
   * to direct the user in a more seamless method.
   *
   * This will always create a new folder on disk does not import into existing projects.
   * Desktop only command for now!
   */
  const createASampleDesktopOnly: Command = {
    name: 'create-a-sample',
    displayName: 'Create a sample',
    description: 'Create a new project from a Zoo Sample',
    needsReview: false,
    icon: 'importFile',
    groupId: 'application',
    hideFromSearch: true,
    onSubmit: (data) => {
      if (data) {
        const folders = getHomeProjectFileEntries(app)
        const kclSample = findKclSample(data.sample)
        if (!kclSample) {
          toast.error(
            'The command could not be submitted, unable to find Zoo sample.'
          )
          return
        }
        const pathParts = webSafePathSplit(
          kclSample.pathFromProjectDirectoryToFirstFile
        )
        const folderNameBecomesSampleName = pathParts[0]
        const uniqueNameIfNeeded = getUniqueProjectName(
          folderNameBecomesSampleName,
          folders
        )
        onSubmitKCLSampleCreation({
          app,
          sample: data.sample,
          uniqueNameIfNeeded,
          isProjectNew: true,
        })
      }
    },
    args: {
      source: {
        inputType: 'string',
        required: true,
        skip: false,
        defaultValue: 'local',
        hidden: true,
      },
      sample: {
        inputType: 'options',
        required: true,
        valueSummary(value) {
          const MAX_LENGTH = 12
          if (typeof value === 'string') {
            return value.length > MAX_LENGTH
              ? `${value.substring(0, MAX_LENGTH)}...`
              : value
          }
          return value
        },
        options: everyKclSample.map((sample) => {
          return {
            value: sample.pathFromProjectDirectoryToFirstFile,
            name: sample.title,
          }
        }),
      },
    },
  }

  const switchEnvironmentsCommand: Command = {
    name: 'switch-environments',
    displayName: 'Switch Environments',
    description: 'Connect the application runtime to a different environment',
    needsReview: false,
    icon: 'gear',
    groupId: 'application',
    onSubmit: (data) => {
      if (data) {
        const requestedEnvironmentFormatted = returnSelfOrGetHostNameFromURL(
          data.environment
        )
        writeEnvironmentFile(requestedEnvironmentFormatted)
          .then(() => {
            // Reload the application and it will trigger the correct sign in workflow for the new environment
            window.location.reload()
          })
          .catch(reportRejection)
      }
    },
    args: {
      environment: {
        inputType: 'string',
        required: true,
        displayName: 'Domain',
      },
    },
  }

  const overrideEngineCommand: Command = {
    name: 'override-engine',
    displayName: 'Override Engine',
    description: 'Connect the scene to a custom Engine WebSocket URL',

    icon: 'gear',
    groupId: 'application',
    needsReview: true,
    reviewValidation: async (context) => {
      const url = context.argumentsToSubmit.url as string | undefined
      if (url) {
        try {
          new URL(url)
        } catch {
          return new Error('Invalid Engine WebSocket URL')
        }
      }
    },
    onSubmit: (data) => {
      const environmentName = env().VITE_ZOO_BASE_DOMAIN
      if (environmentName) {
        writeEnvironmentConfigurationKittycadWebSocketUrl(
          environmentName,
          data?.url ?? ''
        )
          .then(() => {
            window.location.reload()
          })
          .catch(reportRejection)
      }
    },
    args: {
      url: {
        inputType: 'string',
        required: false,
        displayName: 'URL',
        description: `
          Locally-running Engines: **ws://localhost:8080/ws/modeling/commands**
          Pull Requests: **wss://api.dev.zoo.dev/ws/modeling/commands?pr=NUMBER**
          Other variants: **wss://api.dev.zoo.dev/ws/modeling/commands?pool=LABEL**
        `.trim(),
        defaultValue: () => env().VITE_KITTYCAD_WEBSOCKET_URL ?? '',
      },
    },
  }

  const overrideZookeeperCommand: Command = {
    name: 'override-zookeeper',
    displayName: 'Override Zookeeper',
    description: 'Connect to a custom Zookeeper WebSocket URL',
    icon: 'gear',
    groupId: 'application',
    needsReview: true,
    reviewValidation: async (context) => {
      const url = context.argumentsToSubmit.url as string | undefined
      if (url) {
        try {
          new URL(url)
        } catch {
          return new Error('Invalid Zookeeper WebSocket URL')
        }
      }
    },
    onSubmit: (data) => {
      const environmentName = env().VITE_ZOO_BASE_DOMAIN
      if (environmentName) {
        writeEnvironmentConfigurationZookeeperWebSocketUrl(
          environmentName,
          data?.url ?? ''
        )
          .then(() => {
            window.location.reload()
          })
          .catch(reportRejection)
      }
    },
    args: {
      url: {
        inputType: 'string',
        required: false,
        displayName: 'URL',
        description: `
          Locally-running Zookeeper: **ws://localhost:8080/ws/ml/copilot**
          Pull Requests: **wss://api.dev.zoo.dev/ws/ml/copilot?pr=NUMBER**
        `.trim(),
        defaultValue: () => env().VITE_ZOOKEEPER_WEBSOCKET_URL ?? '',
      },
    },
  }

  const resetLayoutCommand: Command = {
    name: 'reset-layout',
    displayName: 'Reset layout',
    description: 'Reset layout to the default configuration',
    needsReview: false,
    icon: 'layout',
    groupId: 'application',
    onSubmit: app.layout.reset,
  }

  const setLayoutCommand: Command = {
    name: 'set-layout',
    hideFromSearch: true,
    displayName: 'Set layout',
    description: 'Set layout to be a certain predefined configuration',
    needsReview: false,
    icon: 'layout',
    groupId: 'application',
    onSubmit: (data) => {
      if (isUserLoadableLayoutKey(data?.layoutId)) {
        app.layout.set(userLoadableLayouts[data.layoutId])
        // This command is silent, we don't toast success, because
        // it is often used in conjunction with other commands and actions
        // that occur on app load, and we don't want to spam the user.
      } else {
        toast.error(`No layout found with ID "${data?.layoutId}".`)
      }
    },
    args: {
      layoutId: {
        inputType: 'options',
        defaultValue: 'default',
        skip: true,
        required: true,
        /** These options must correspond to configs within `@src/lib/layout/configs/` */
        options: [
          {
            name: 'Default',
            value: 'default',
          },
          {
            name: 'Zookeeper focus',
            value: 'zookeeper',
          },
          {
            name: 'Zookeeper focus (legacy URL)',
            value: 'ttc',
          },
        ] satisfies { name: string; value: keyof typeof userLoadableLayouts }[],
      },
    },
  }

  const checkForUpdatesCommand: Command = {
    name: 'check-for-updates',
    displayName: 'Check for updates',
    description: 'Check for a newer desktop app version.',
    needsReview: false,
    icon: 'download',
    groupId: 'application',
    onSubmit: () => {
      if (!window.electron) {
        return new Error(
          'Checking for updates is only available in the desktop app.'
        )
      }

      return window.electron.appCheckForUpdates()
    },
  }

  const exportProjectZipCommand: Command = {
    name: 'export-project-zip',
    displayName: 'Download project files',
    description: 'Download every file in the current project as a ZIP archive.',
    needsReview: false,
    icon: 'download',
    groupId: 'application',
    onSubmit: async () => {
      const openedProject = app.registry.get(projectSession).getProject()
      const project = openedProject?.projectIORefSignal.value
      const executingEditor = openedProject?.executingEditor.value
      const wasmInstance = await app.wasmPromise

      await exportProjectZip({
        project,
        currentFilePath: openedProject?.executingPath,
        currentFileContents: executingEditor?.code,
        wasmInstance,
      })
    },
  }

  return [
    addKCLFileToProject,
    ...(!isDesktop() ? [exportProjectZipCommand] : []),
    ...(isDesktop() ? [checkForUpdatesCommand] : []),
    resetLayoutCommand,
    setLayoutCommand,
    createASampleDesktopOnly,
    switchEnvironmentsCommand,
    overrideEngineCommand,
    overrideZookeeperCommand,
  ]
}

export function sendAddFileToProjectCommandForCurrentProject(
  _settingsActor: SettingsActorType,
  commandBarActor: CommandBarActorType,
  currentProjectOptionValue?: string
) {
  const event = {
    type: 'Find and select command',
    data: {
      ...ADD_FILE_TO_PROJECT_COMMAND,
      argDefaultValues: {
        method: 'existingProject',
        ...(currentProjectOptionValue
          ? { projectName: currentProjectOptionValue }
          : {}),
        ...(!isDesktop() ? { source: 'kcl-samples' } : {}),
      },
    },
  } as const
  const hasCommand = () =>
    commandBarActor
      .getSnapshot()
      .context.commands.some(
        (command) =>
          command.name === ADD_FILE_TO_PROJECT_COMMAND.name &&
          command.groupId === ADD_FILE_TO_PROJECT_COMMAND.groupId
      )

  if (hasCommand()) {
    commandBarActor.send(event)
    return
  }

  void waitFor(
    commandBarActor,
    (snapshot) =>
      snapshot.context.commands.some(
        (command) =>
          command.name === ADD_FILE_TO_PROJECT_COMMAND.name &&
          command.groupId === ADD_FILE_TO_PROJECT_COMMAND.groupId
      ),
    { timeout: 5000 }
  )
    .then(() => {
      commandBarActor.send(event)
    })
    .catch(() => undefined)
}
