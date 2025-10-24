import env from '@src/env'
import { relevantFileExtensions } from '@src/lang/wasmUtils'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import { IS_ML_EXPERIMENTAL } from '@src/lib/constants'
import {
  writeEnvironmentConfigurationPool,
  writeEnvironmentFile,
} from '@src/lib/desktop'
import { getUniqueProjectName } from '@src/lib/desktopFS'
import { isDesktop } from '@src/lib/isDesktop'
import {
  everyKclSample,
  findKclSample,
  kclSamplesManifestWithNoMultipleFiles,
} from '@src/lib/kclSamples'
import {
  getStringAfterLastSeparator,
  joinOSPaths,
  webSafePathSplit,
} from '@src/lib/paths'
import { reportRejection } from '@src/lib/trap'
import { returnSelfOrGetHostNameFromURL } from '@src/lib/utils'
import type { MlEphantManagerActor } from '@src/machines/mlEphantManagerMachine'
import { MlEphantManagerTransitions } from '@src/machines/mlEphantManagerMachine'
import { getAllSubDirectoriesAtProjectRoot } from '@src/machines/systemIO/snapshotContext'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import type { RequestedKCLFile } from '@src/machines/systemIO/utils'
import { waitForIdleState } from '@src/machines/systemIO/utils'
import {
  SystemIOMachineEvents,
  determineProjectFilePathFromPrompt,
} from '@src/machines/systemIO/utils'
import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'
import toast from 'react-hot-toast'
import type { ActorRefFrom } from 'xstate'
import { appActor, setLayout } from '@src/lib/singletons'
import { AppMachineEventType } from '@src/lib/types'
import { isUserLoadableLayoutKey, userLoadableLayouts } from '@src/lib/layout'

function onSubmitKCLSampleCreation({
  sample,
  kclSample,
  uniqueNameIfNeeded,
  systemIOActor,
  isProjectNew,
}: {
  sample: any
  kclSample: ReturnType<typeof findKclSample>
  uniqueNameIfNeeded: any
  systemIOActor: ActorRefFrom<typeof systemIOMachine>
  isProjectNew: boolean
}) {
  if (!kclSample) {
    toast.error('The command could not be submitted, unable to find Zoo sample')
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
        requestedFiles.forEach((requestedFile) => {
          const subDirectoryName = projectPathPart
          const firstLevelDirectories = getAllSubDirectoriesAtProjectRoot(
            systemIOActor.getSnapshot().context,
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

      if (requestedFiles.length === 1) {
        systemIOActor.send({
          type: SystemIOMachineEvents.importFileFromURL,
          data: {
            requestedProjectName: requestedFiles[0].requestedProjectName,
            requestedFileNameWithExtension: requestedFiles[0].requestedFileName,
            requestedCode: requestedFiles[0].requestedCode,
          },
        })
      } else {
        /**
         * Bulk create the assembly and navigate to the project
         */
        systemIOActor.send({
          type: SystemIOMachineEvents.bulkCreateKCLFilesAndNavigateToProject,
          data: {
            files: requestedFiles,
            requestedProjectName: uniqueNameIfNeeded,
          },
        })
      }
    })
    .catch(reportError)
}

export function createApplicationCommands({
  systemIOActor,
  mlEphantManagerActor,
}: {
  systemIOActor: ActorRefFrom<typeof systemIOMachine>
  mlEphantManagerActor: MlEphantManagerActor
}) {
  const textToCADCommand: Command = {
    name: 'Text-to-CAD',
    description: 'Generate parts from text prompts.',
    displayName: 'Create Project using Text-to-CAD',
    groupId: 'application',
    needsReview: false,
    status: IS_ML_EXPERIMENTAL ? 'experimental' : 'active',
    mlBranding: true,
    icon: 'sparkles',
    onSubmit: (record) => {
      if (record) {
        const requestedProjectName = record.newProjectName || record.projectName
        const requestedPrompt = record.prompt

        const { folders } = systemIOActor.getSnapshot().context

        const uniqueProjectPath = getUniqueProjectName(
          requestedProjectName,
          folders
        )
        const uniquePromptFilePath = determineProjectFilePathFromPrompt(
          systemIOActor.getSnapshot().context,
          {
            existingProjectName: uniqueProjectPath,
            requestedPrompt,
          }
        )

        systemIOActor.send({
          type: SystemIOMachineEvents.importFileFromURL,
          data: {
            requestedProjectName: uniqueProjectPath,
            requestedCode: '',
            requestedFileNameWithExtension: PROJECT_ENTRYPOINT,
          },
        })

        // TODO: Remove this await and instead add a call back or something
        // to the event above
        waitForIdleState({ systemIOActor })
          .then(() => {
            mlEphantManagerActor.send({
              type: MlEphantManagerTransitions.PromptCreateModel,
              // It's always going to be a fresh directory since it's a new
              // project.
              projectForPromptOutput: {
                name: '',
                path: uniquePromptFilePath,
                children: [],
                readWriteAccess: true,
                metadata: {
                  accessed: '',
                  created: '',
                  modified: '',
                  permission: null,
                  type: null,
                  size: 0,
                },
                kcl_file_count: 0,
                directory_count: 0,
                default_file: '',
              },
              prompt: requestedPrompt,
            })
          })
          .catch(reportRejection)
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
              // TODO: figure out what to do with this step
              // { name: 'Existing project', value: 'existingProject' },
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
        defaultValue: isDesktop() ? undefined : 'browser',
        skip: true,
        options: (_, _context) => {
          const { folders } = systemIOActor.getSnapshot().context
          const options: CommandArgumentOption<string>[] = []
          folders.forEach((folder) => {
            options.push({
              name: folder.name,
              value: folder.name,
              isCurrent: false,
            })
          })
          return options
        },
      },
      newProjectName: {
        inputType: 'text',
        required: (commandsContext) =>
          isDesktop() &&
          commandsContext.argumentsToSubmit.method === 'newProject',
        skip: true,
      },
      prompt: {
        inputType: 'text',
        required: true,
      },
    },
  }

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
        /** TODO: Make a new machine for models. This is only a temporary location
         * to move it to the global application level. To reduce its footprint
         * and complexity the implementation lives here with systemIOMachine. Not
         * inside the systemIOMachine. We can have a fancy model machine that loads
         * KCL samples
         */
        const folders = systemIOActor.getSnapshot().context.folders
        const isProjectNew = !!data.newProjectName
        const requestedProjectName = data.newProjectName || data.projectName
        const uniqueNameIfNeeded = isProjectNew
          ? getUniqueProjectName(requestedProjectName, folders)
          : requestedProjectName

        const kclSample = findKclSample(data.sample)
        if (
          data.source === 'kcl-samples' &&
          kclSample &&
          kclSample.files.length >= 1
        ) {
          onSubmitKCLSampleCreation({
            sample: data.sample,
            kclSample,
            uniqueNameIfNeeded,
            systemIOActor,
            isProjectNew,
          })
        } else if (window.electron && data.source === 'local' && data.path) {
          const electron = window.electron
          const clonePath = data.path
          const fileNameWithExtension = getStringAfterLastSeparator(clonePath)
          const readFileContentsAndCreateNewFile = async () => {
            const text = await electron.readFile(clonePath, 'utf8')
            systemIOActor.send({
              type: SystemIOMachineEvents.importFileFromURL,
              data: {
                requestedProjectName: uniqueNameIfNeeded,
                requestedFileNameWithExtension: fileNameWithExtension,
                requestedCode: text,
              },
            })
          }
          readFileContentsAndCreateNewFile().catch(reportRejection)
        } else {
          toast.error("The command couldn't be submitted, check the arguments.")
        }
      }
    },
    args: {
      source: {
        inputType: 'options',
        required: true,
        skip: false,
        defaultValue: isDesktop() ? 'local' : 'kcl-samples',
        options() {
          return [
            {
              value: 'kcl-samples',
              name: 'KCL Samples',
              isCurrent: true,
            },
            ...(isDesktop()
              ? [
                  {
                    value: 'local',
                    name: 'Local Drive',
                    isCurrent: false,
                  },
                ]
              : []),
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
        options: ({ argumentsToSubmit }) => {
          const samples = isDesktop()
            ? everyKclSample
            : kclSamplesManifestWithNoMultipleFiles
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
        options: ({ argumentsToSubmit }, _) => {
          if (isDesktop() && typeof argumentsToSubmit.sample === 'string') {
            return [
              { name: 'New project', value: 'newProject', isCurrent: true },
              { name: 'Existing project', value: 'existingProject' },
            ]
          } else {
            return [{ name: 'Overwrite', value: 'existingProject' }]
          }
        },
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
        defaultValue: isDesktop() ? undefined : 'browser',
        options: (_, _context) => {
          const { folders } = systemIOActor.getSnapshot().context
          const options: CommandArgumentOption<string>[] = []
          folders.forEach((folder) => {
            options.push({
              name: folder.name,
              value: folder.name,
              isCurrent: false,
            })
          })
          return options
        },
      },
      newProjectName: {
        inputType: 'text',
        required: (commandsContext) =>
          isDesktop() &&
          commandsContext.argumentsToSubmit.method === 'newProject',
        skip: true,
      },
      path: {
        inputType: 'path',
        skip: true,
        hidden: !isDesktop(),
        defaultValue: '',
        valueSummary: (value) => {
          return window.electron ? window.electron.path.basename(value) : ''
        },
        required: (commandContext) =>
          isDesktop() &&
          ['local'].includes(commandContext.argumentsToSubmit.source as string),
        filters: [
          {
            name: `Import ${relevantFileExtensions().map((f) => ` .${f}`)}`,
            extensions: relevantFileExtensions(),
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
        const folders = systemIOActor.getSnapshot().context.folders
        const kclSample = findKclSample(data.sample)
        if (!kclSample) {
          toast.error(
            'The command could not be submitted, unable to find Zoo sample'
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
          sample: data.sample,
          kclSample,
          uniqueNameIfNeeded,
          systemIOActor,
          isProjectNew: true,
        })
      }
    },
    args: {
      source: {
        inputType: 'text',
        required: true,
        skip: false,
        defaultValue: 'kcl-samples',
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
    displayName: 'Switch environments',
    description:
      'Switch between different environments to connect your application runtime',
    needsReview: false,
    icon: 'importFile',
    groupId: 'application',
    onSubmit: (data) => {
      if (!window.electron) {
        console.error(new Error('No file system present'))
        return
      }
      if (data) {
        const requestedEnvironmentFormatted = returnSelfOrGetHostNameFromURL(
          data.environment
        )
        writeEnvironmentFile(window.electron, requestedEnvironmentFormatted)
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
      },
    },
  }

  const choosePoolCommand: Command = {
    name: 'choose-pool',
    displayName: 'Choose pool',
    description: 'Switch between different engine pools',
    needsReview: true,
    icon: 'importFile',
    groupId: 'application',
    onSubmit: (data) => {
      if (!window.electron) {
        console.error(new Error('No file system present'))
        return
      }
      if (data) {
        const environmentName = env().VITE_KITTYCAD_BASE_DOMAIN
        if (environmentName)
          writeEnvironmentConfigurationPool(
            window.electron,
            environmentName,
            data.pool
          )
            .then(() => {
              // Reload the application and it will trigger the correct sign in workflow for the new environment
              window.location.reload()
            })
            .catch(reportRejection)
      }
    },
    args: {
      pool: {
        inputType: 'string',
        required: false,
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
    onSubmit: () => {
      appActor.send({ type: AppMachineEventType.ResetLayout })
    },
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
        setLayout(userLoadableLayouts[data.layoutId])
        // This command is silent, we don't toast success, because
        // it is often used in conjunction with other commands and actions
        // that occur on app load, and we don't want to spam the user.
      } else {
        toast.error(`No layout found with ID "${data?.layoutId}"`)
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

  return isDesktop()
    ? [
        ...(IS_STAGING_OR_DEBUG ? [] : [textToCADCommand]),
        addKCLFileToProject,
        resetLayoutCommand,
        setLayoutCommand,
        createASampleDesktopOnly,
        switchEnvironmentsCommand,
        choosePoolCommand,
      ]
    : [
        ...(IS_STAGING_OR_DEBUG ? [] : [textToCADCommand]),
        addKCLFileToProject,
        resetLayoutCommand,
        setLayoutCommand,
      ]
}
