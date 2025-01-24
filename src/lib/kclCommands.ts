import { CommandBarOverwriteWarning } from 'components/CommandBarOverwriteWarning'
import { Command, CommandArgumentOption } from './commandTypes'
import { codeManager, kclManager } from './singletons'
import { isDesktop } from './isDesktop'
import { FILE_EXT, PROJECT_SETTINGS_FILE_NAME } from './constants'
import { UnitLength_type } from '@kittycad/lib/dist/types/src/models'
import { parseProjectSettings } from 'lang/wasm'
import { err, reportRejection } from './trap'
import { projectConfigurationToSettingsPayload } from './settings/settingsUtils'
import { copyFileShareLink } from './links'
import { IndexLoaderData } from './types'

interface OnSubmitProps {
  sampleName: string
  code: string
  sampleUnits?: UnitLength_type
  method: 'overwrite' | 'newFile'
}

interface KclCommandConfig {
  // TODO: find a different approach that doesn't require
  // special props for a single command
  specialPropsForSampleCommand: {
    onSubmit: (p: OnSubmitProps) => Promise<void>
    providedOptions: CommandArgumentOption<string>[]
  }
  projectData: IndexLoaderData
  authToken: string
  settings: {
    defaultUnit: UnitLength_type
  }
}

export function kclCommands(commandProps: KclCommandConfig): Command[] {
  return [
    {
      name: 'format-code',
      displayName: 'Format Code',
      description: 'Nicely formats the KCL code in the editor.',
      needsReview: false,
      groupId: 'code',
      icon: 'code',
      onSubmit: () => {
        kclManager.format().catch(reportRejection)
      },
    },
    {
      name: 'open-kcl-example',
      displayName: 'Open sample',
      description: 'Imports an example KCL program into the editor.',
      needsReview: true,
      icon: 'code',
      reviewMessage: ({ argumentsToSubmit }) =>
        argumentsToSubmit.method === 'newFile'
          ? CommandBarOverwriteWarning({
              heading: 'Create a new file, overwrite project units?',
              message: `This will add the sample as a new file to your project, and replace your current project units with the sample's units.`,
            })
          : CommandBarOverwriteWarning({}),
      groupId: 'code',
      onSubmit(data) {
        if (!data?.sample) {
          return
        }
        const pathParts = data.sample.split('/')
        const projectPathPart = pathParts[0]
        const primaryKclFile = pathParts[1]
        const sampleCodeUrl = `https://raw.githubusercontent.com/KittyCAD/kcl-samples/main/${encodeURIComponent(
          projectPathPart
        )}/${encodeURIComponent(primaryKclFile)}`
        const sampleSettingsFileUrl = `https://raw.githubusercontent.com/KittyCAD/kcl-samples/main/${encodeURIComponent(
          projectPathPart
        )}/${PROJECT_SETTINGS_FILE_NAME}`

        Promise.allSettled([fetch(sampleCodeUrl), fetch(sampleSettingsFileUrl)])
          .then((results) => {
            const a =
              'value' in results[0] ? results[0].value : results[0].reason
            const b =
              'value' in results[1] ? results[1].value : results[1].reason
            return [a, b]
          })
          .then(
            async ([
              codeResponse,
              settingsResponse,
            ]): Promise<OnSubmitProps> => {
              if (!codeResponse.ok) {
                console.error(
                  'Failed to fetch sample code:',
                  codeResponse.statusText
                )
                return Promise.reject(new Error('Failed to fetch sample code'))
              }
              const code = await codeResponse.text()

              // It's possible that a sample doesn't have a project.toml
              // associated with it.
              let projectSettingsPayload: ReturnType<
                typeof projectConfigurationToSettingsPayload
              > = {}
              if (settingsResponse.ok) {
                const parsedProjectSettings = parseProjectSettings(
                  await settingsResponse.text()
                )
                if (!err(parsedProjectSettings)) {
                  projectSettingsPayload =
                    projectConfigurationToSettingsPayload(parsedProjectSettings)
                }
              }

              return {
                sampleName: data.sample.split('/')[0] + FILE_EXT,
                code,
                method: data.method,
                sampleUnits:
                  projectSettingsPayload.modeling?.defaultUnit || 'mm',
              }
            }
          )
          .then((props) => {
            if (props?.code) {
              commandProps.specialPropsForSampleCommand
                .onSubmit(props)
                .catch(reportError)
            }
          })
          .catch(reportError)
      },
      args: {
        method: {
          inputType: 'options',
          required: true,
          skip: true,
          defaultValue: isDesktop() ? 'newFile' : 'overwrite',
          options() {
            return [
              {
                value: 'overwrite',
                name: 'Overwrite current code',
                isCurrent: !isDesktop(),
              },
              ...(isDesktop()
                ? [
                    {
                      value: 'newFile',
                      name: 'Create a new file',
                      isCurrent: true,
                    },
                  ]
                : []),
            ]
          },
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
          options: commandProps.specialPropsForSampleCommand.providedOptions,
        },
      },
    },
    // {
    //   name: 'share-file-link',
    //   displayName: 'Share file',
    //   description: 'Create a link that contains a copy of the current file.',
    //   groupId: 'code',
    //   needsReview: false,
    //   icon: 'link',
    //   onSubmit: () => {
    //     copyFileShareLink({
    //       token: commandProps.authToken,
    //       code: codeManager.code,
    //       name: commandProps.projectData.project?.name || '',
    //       units: commandProps.settings.defaultUnit,
    //     }).catch(reportRejection)
    //   },
    // },
  ]
}
