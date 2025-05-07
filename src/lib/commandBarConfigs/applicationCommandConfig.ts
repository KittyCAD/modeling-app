import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import type { ActorRefFrom } from 'xstate'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import type { RequestedKCLFile } from '@src/machines/systemIO/utils'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { isDesktop } from '@src/lib/isDesktop'
import { everyKclSample, findKclSample } from '@src/lib/kclSamples'
import { getUniqueProjectName } from '@src/lib/desktopFS'
import { IS_ML_EXPERIMENTAL, ML_EXPERIMENTAL_MESSAGE } from '@src/lib/constants'
import toast from 'react-hot-toast'
import { reportRejection } from '@src/lib/trap'
import { relevantFileExtensions } from '@src/lang/wasmUtils'
import { getStringAfterLastSeparator, webSafePathSplit } from '@src/lib/paths'

export function createApplicationCommands({
  systemIOActor,
}: {
  systemIOActor: ActorRefFrom<typeof systemIOMachine>
}) {
  const textToCADCommand: Command = {
    name: 'Text-to-CAD',
    description: 'Generate parts from text prompts.',
    displayName: 'Text to CAD',
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
        skip: true,
        options: (_, context) => {
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
        warningMessage: ML_EXPERIMENTAL_MESSAGE,
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
        if (kclSample && kclSample.files.length >= 1) {
          const pathParts = webSafePathSplit(data.sample)
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
                  requestedProjectName: requestedProjectName,
                })
              }

              if (requestedFiles.length === 1) {
                /**
                 * Navigates to the single file that could be renamed on disk for duplicates
                 */
                systemIOActor.send({
                  type: SystemIOMachineEvents.importFileFromURL,
                  data: {
                    requestedProjectName:
                      requestedFiles[0].requestedProjectName,
                    requestedFileNameWithExtension:
                      requestedFiles[0].requestedFileName,
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
                    requestedProjectName: requestedProjectName,
                  },
                })
              }
            })
            .catch(reportError)
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
        options: everyKclSample.map((sample) => {
          return {
            value: sample.pathFromProjectDirectoryToFirstFile,
            name: sample.title,
          }
        }),
      },
      method: {
        inputType: 'options',
        required: true,
        skip: true,
        options: ({ argumentsToSubmit }, _) => {
          if (isDesktop() && typeof argumentsToSubmit.sample === 'string') {
            const kclSample = findKclSample(argumentsToSubmit.sample)
            if (kclSample && kclSample.files.length > 1) {
              return [
                { name: 'New project', value: 'newProject', isCurrent: true },
              ]
            } else {
              return [
                { name: 'New project', value: 'newProject', isCurrent: true },
                { name: 'Existing project', value: 'existingProject' },
              ]
            }
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
        options: (_, context) => {
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

  return isDesktop()
    ? [textToCADCommand, addKCLFileToProject]
    : [textToCADCommand, addKCLFileToProject]
}
