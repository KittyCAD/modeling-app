import env from '@src/env'
import { relevantFileExtensions } from '@src/lang/wasmUtils'
import type { App } from '@src/lib/app'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import {
  getProjectInfo,
  writeEnvironmentConfigurationKittycadWebSocketUrl,
  writeEnvironmentConfigurationMlephantWebSocketUrl,
  writeEnvironmentFile,
} from '@src/lib/desktop'
import { getNextFileName, getUniqueProjectName } from '@src/lib/desktopFS'
import { exportProjectZip } from '@src/lib/exportProjectZip'
import fsZds from '@src/lib/fs-zds'
import { isDesktop } from '@src/lib/isDesktop'
import { everyKclSample, findKclSample } from '@src/lib/kclSamples'
import { isUserLoadableLayoutKey, userLoadableLayouts } from '@src/lib/layout'
import {
  PATHS,
  getEXTNoPeriod,
  getStringAfterLastSeparator,
  joinOSPaths,
  safeEncodeForRouterPaths,
  webSafePathSplit,
} from '@src/lib/paths'
import { reportRejection } from '@src/lib/trap'
import { isArray, returnSelfOrGetHostNameFromURL } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { CommandBarActorType } from '@src/machines/commandBarMachine'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import type { RequestedKCLFile } from '@src/registry/contracts/systemIO'
import toast from 'react-hot-toast'

function onSubmitKCLSampleCreation({
  sample,
  kclSample,
  uniqueNameIfNeeded,
  app,
  isProjectNew,
}: {
  sample: any
  kclSample: ReturnType<typeof findKclSample>
  uniqueNameIfNeeded: any
  app: App
  isProjectNew: boolean
}) {
  if (!kclSample) {
    toast.error(
      'The command could not be submitted, unable to find Zoo sample.'
    )
    return
  }
  const pathParts = webSafePathSplit(sample)
  const projectPathPart = pathParts[0]
  const files = kclSample.files

  const filePromises = files.map((file) => {
    const sampleCodeUrl =
      (isDesktop() ? '.' : '') +
      `/kcl-samples/${encodeURIComponent(
        projectPathPart
      )}/${encodeURIComponent(file)}`
    return fetch(sampleCodeUrl).then((response) => {
      return {
        response,
        file,
        projectName: projectPathPart,
      }
    })
  })

  const requestedFiles: RequestedKCLFile[] = []
  // If any fetches fail from the KCL Code download we will instantly reject
  // No cleanup required since the fetch response is in memory
  // TODO: Try to catch if there is a failure then delete the root folder and show error
  Promise.all(filePromises)
    .then(async (responses) => {
      for (let i = 0; i < responses.length; i++) {
        const response = responses[i]
        const code = await response.response.text()
        requestedFiles.push({
          requestedCode: code,
          requestedFileName: response.file,
          requestedProjectName: uniqueNameIfNeeded,
        })
      }

      /**
       * When adding assemblies to an existing project create the assembly into a unique sub directory
       */
      if (!isProjectNew) {
        for (const requestedFile of requestedFiles) {
          const subDirectoryName = projectPathPart
          const project = await getProjectInfo(
            joinOSPaths(
              app.settings.get().app.projectDirectory.current,
              requestedFile.requestedProjectName
            ),
            await app.wasmPromise
          )
          const firstLevelDirectories =
            project.children?.filter((entry) => entry.children !== null) ?? []
          const uniqueSubDirectoryName = getUniqueProjectName(
            subDirectoryName,
            firstLevelDirectories
          )
          requestedFile.requestedProjectName = joinOSPaths(
            requestedFile.requestedProjectName,
            uniqueSubDirectoryName
          )
        }
      }

      if (requestedFiles.length === 1) {
        const result = await app.systemIO.request({
          type: 'file.createKCL',
          requestedProjectName: requestedFiles[0].requestedProjectName,
          requestedFileNameWithExtension: requestedFiles[0].requestedFileName,
          requestedCode: requestedFiles[0].requestedCode,
        })
        if (result.projectName && result.fileName) {
          navigateToFile(
            joinOSPaths(
              app.settings.get().app.projectDirectory.current,
              result.projectName,
              result.fileName
            )
          )
        }
      } else {
        const result = await app.systemIO.request({
          type: 'files.bulkCreateKCL',
          files: requestedFiles,
          requestedProjectName: uniqueNameIfNeeded,
        })
        if (result.projectName) {
          const project = await app.systemIO.request({
            type: 'project.loadTree',
            projectPath: joinOSPaths(
              app.settings.get().app.projectDirectory.current,
              result.projectName
            ),
          })
          navigateToFile(project.default_file)
        }
      }
    })
    .catch(reportError)
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
        /** TODO: Make a new model import subsystem. This is only a temporary
         * location to move the workflow to the global application level.
         */
        const error = "The command couldn't be submitted, check the arguments."
        const localProjectEntries = app.systemIO.localProjectEntriesSignal.value
        const isProjectNew = !!data.newProjectName
        const requestedProjectName = data.newProjectName || data.projectName
        const uniqueNameIfNeeded = isProjectNew
          ? getUniqueProjectName(
              requestedProjectName,
              localProjectEntries.map((project) => ({
                name: project.localProjectName || project.name,
                path:
                  project.localProjectPath ||
                  joinOSPaths(
                    app.settings.get().app.projectDirectory.current,
                    project.localProjectName || project.name
                  ),
                children: [],
              }))
            )
          : requestedProjectName

        if (data.source === 'kcl-samples') {
          const kclSample = findKclSample(data.sample)
          if (!kclSample || kclSample.files.length === 0) {
            toast.error("Couldn't find KCL sample.")
          } else {
            onSubmitKCLSampleCreation({
              sample: data.sample,
              kclSample,
              uniqueNameIfNeeded,
              app,
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

              void app.systemIO
                .request({
                  type: 'file.createKCL',
                  requestedProjectName: uniqueNameIfNeeded,
                  requestedFileNameWithExtension: fileNameWithExtension,
                  requestedCode: fr.result,
                })
                .then((result) => {
                  if (result.projectName && result.fileName) {
                    navigateToFile(
                      joinOSPaths(
                        app.settings.get().app.projectDirectory.current,
                        result.projectName,
                        result.fileName
                      )
                    )
                  }
                })
            } else {
              if (!(fr.result instanceof ArrayBuffer)) {
                toast.error(error)
                return
              }

              const projectDirectoryPath =
                app.settings.get().app.projectDirectory.current
              const fileData = new Uint8Array(fr.result)

              getNextFileName({
                entryName: fileNameWithExtension,
                baseDir: joinOSPaths(projectDirectoryPath, uniqueNameIfNeeded),
                wasmInstance,
                preserveUnknownExtension: true,
              })
                .then(({ path }) => {
                  return fsZds.writeFile(path, fileData)
                })
                .then(() => {
                  app.systemIO.markCurrentProjectTreeDirty()
                  void app.systemIO.refreshLocalProjects()
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
              ? value.substring(0, MAX_LENGTH) + '...'
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
        defaultValue: () => app.project?.name,
        options: (_, _context) => {
          const options: CommandArgumentOption<string>[] = []
          app.systemIO.localProjectEntriesSignal.value.forEach((folder) => {
            if (!folder.localProjectName) {
              return
            }
            options.push({
              name: folder.title || folder.localProjectName,
              value: folder.localProjectName,
              isCurrent: false,
            })
          })
          return options
        },
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
          if (typeof value === 'string') return fsZds.basename(value)
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
          app.systemIO.localProjectEntriesSignal.value.map((project) => ({
            name: project.localProjectName || project.name,
            path:
              project.localProjectPath ||
              joinOSPaths(
                app.settings.get().app.projectDirectory.current,
                project.localProjectName || project.name
              ),
            children: [],
          }))
        )
        onSubmitKCLSampleCreation({
          sample: data.sample,
          kclSample,
          uniqueNameIfNeeded,
          app,
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
              ? value.substring(0, MAX_LENGTH) + '...'
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
      if (environmentName)
        writeEnvironmentConfigurationKittycadWebSocketUrl(
          environmentName,
          data?.url ?? ''
        )
          .then(() => {
            window.location.reload()
          })
          .catch(reportRejection)
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
      if (environmentName)
        writeEnvironmentConfigurationMlephantWebSocketUrl(
          environmentName,
          data?.url ?? ''
        )
          .then(() => {
            window.location.reload()
          })
          .catch(reportRejection)
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
        defaultValue: () => env().VITE_MLEPHANT_WEBSOCKET_URL ?? '',
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
            name: 'Text-to-CAD focus',
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
      const project = app.project?.projectIORefSignal.value
      const executingEditor = app.project?.executingEditor.value
      const wasmInstance = await app.wasmPromise

      await exportProjectZip({
        project,
        currentFilePath: app.project?.executingPath,
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
  settingsActor: SettingsActorType,
  commandBarActor: CommandBarActorType
) {
  const currentProject = settingsActor.getSnapshot().context.currentProject
  commandBarActor.send({
    type: 'Find and select command',
    data: {
      name: 'add-kcl-file-to-project',
      groupId: 'application',
      argDefaultValues: {
        method: 'existingProject',
        projectName: currentProject?.name,
        ...(!isDesktop() ? { source: 'kcl-samples' } : {}),
      },
    },
  })
}
