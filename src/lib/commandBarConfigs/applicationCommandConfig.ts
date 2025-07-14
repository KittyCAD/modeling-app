import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import type { ActorRefFrom } from 'xstate'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import type { RequestedKCLFile } from '@src/machines/systemIO/utils'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { isDesktop } from '@src/lib/isDesktop'
import {
  everyKclSample,
  findKclSample,
  kclSamplesManifestWithNoMultipleFiles,
} from '@src/lib/kclSamples'
import { getUniqueProjectName } from '@src/lib/desktopFS'
import {
  IS_ML_EXPERIMENTAL,
  isEnvironmentName,
  SUPPORTED_ENVIRONMENTS,
} from '@src/lib/constants'
import toast from 'react-hot-toast'
import { reportRejection } from '@src/lib/trap'
import { relevantFileExtensions } from '@src/lang/wasmUtils'
import {
  getStringAfterLastSeparator,
  joinOSPaths,
  webSafePathSplit,
} from '@src/lib/paths'
import { getAllSubDirectoriesAtProjectRoot } from '@src/machines/systemIO/snapshotContext'
import {
  writeEnvironmentConfigurationPool,
  writeEnvironmentFile,
} from '@src/lib/desktop'
import { getEnvironmentName } from '@src/env'
import env from '@src/env'

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
          const firstLevelDirectories = getAllSubDirectoriesAtProjectRoot({
            projectFolderName: requestedFile.requestedProjectName,
          })
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
}: {
  systemIOActor: ActorRefFrom<typeof systemIOMachine>
}) {
  const textToCADCommand: Command = {
    name: 'Text-to-CAD',
    description: 'Generate parts from text prompts.',
    displayName: 'Text-to-CAD Create',
    groupId: 'application',
    needsReview: false,
    status: IS_ML_EXPERIMENTAL ? 'experimental' : 'active',
    icon: 'sparkles',
    onSubmit: (record) => {
      if (record) {
        const requestedProjectName = record.newProjectName || record.projectName
        const requestedPrompt = record.prompt
        const isProjectNew = !!record.newProjectName
        systemIOActor.send({
          type: SystemIOMachineEvents.generateTextToCAD,
          data: { requestedPrompt, requestedProjectName, isProjectNew },
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
        } else if (data.source === 'local' && data.path) {
          const clonePath = data.path
          const fileNameWithExtension = getStringAfterLastSeparator(clonePath)
          const readFileContentsAndCreateNewFile = async () => {
            const text = await window.electron.readFile(clonePath, 'utf8')
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
          return isDesktop() ? window.electron.path.basename(value) : ''
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
      if (data) {
        if (isEnvironmentName(data.environment))
          writeEnvironmentFile(data.environment).then(() => {
            // Reload the application and it will trigger the correct sign in workflow for the new environment
            window.location.reload()
          })
      }
    },
    args: {
      environment: {
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
        options: Object.keys(SUPPORTED_ENVIRONMENTS).map((name) => {
          return {
            value: name,
            name: name,
          }
        }),
      },
    },
  }

  const choosePoolCommand: Command = {
    name: 'choose-pool',
    displayName: 'Choose pool',
    description: 'Switch between different engine pools',
    needsReview: false,
    icon: 'importFile',
    groupId: 'application',
    onSubmit: (data) => {
      if (data) {
        const environmentName = getEnvironmentName()
        if (environmentName)
          writeEnvironmentConfigurationPool(environmentName, data.pool).then(
            () => {
              // Reload the application and it will trigger the correct sign in workflow for the new environment
              window.location.reload()
            }
          )
      }
    },
    args: {
      pool: {
        inputType: 'string',
        required: true,
        defaultValue: () => env().POOL,
      },
    },
  }

  return isDesktop()
    ? [
        textToCADCommand,
        addKCLFileToProject,
        createASampleDesktopOnly,
        switchEnvironmentsCommand,
        choosePoolCommand,
      ]
    : [textToCADCommand, addKCLFileToProject]
}
