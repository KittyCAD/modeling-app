import { CommandBarOverwriteWarning } from 'components/CommandBarOverwriteWarning'
import { Command, CommandArgumentOption } from './commandTypes'
import { kclManager } from './singletons'
import { isDesktop } from './isDesktop'
import { FILE_EXT, PROJECT_SETTINGS_FILE_NAME } from './constants'
import { UnitLength_type } from '@kittycad/lib/dist/types/src/models'
import { parseProjectSettings } from 'lang/wasm'
import { err } from './trap'
import { projectConfigurationToSettingsPayload } from './settings/settingsUtils'

interface OnSubmitProps {
  sampleName: string
  code: string
  sampleUnits?: UnitLength_type
  method: 'overwrite' | 'newFile'
}

export function kclCommands(
  onSubmit: (p: OnSubmitProps) => Promise<void>,
  providedOptions: CommandArgumentOption<string>[]
): Command[] {
  return [
    {
      name: 'format-code',
      displayName: 'Format Code',
      description: 'Nicely formats the KCL code in the editor.',
      needsReview: false,
      groupId: 'code',
      icon: 'code',
      onSubmit: () => {
        kclManager.format()
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
        const sampleCodeUrl = `https://raw.githubusercontent.com/KittyCAD/kcl-samples/main/${encodeURIComponent(
          data.sample.replace(FILE_EXT, '')
        )}/${encodeURIComponent(data.sample)}`
        const sampleSettingsFileUrl = `https://raw.githubusercontent.com/KittyCAD/kcl-samples/main/${encodeURIComponent(
          data.sample.replace(FILE_EXT, '')
        )}/${PROJECT_SETTINGS_FILE_NAME}`

        Promise.all([fetch(sampleCodeUrl), fetch(sampleSettingsFileUrl)])
          .then(
            async ([
              codeResponse,
              settingsResponse,
            ]): Promise<OnSubmitProps> => {
              if (!(codeResponse.ok && settingsResponse.ok)) {
                console.error(
                  'Failed to fetch sample code:',
                  codeResponse.statusText
                )
                return Promise.reject(new Error('Failed to fetch sample code'))
              }
              const code = await codeResponse.text()
              const parsedProjectSettings = parseProjectSettings(
                await settingsResponse.text()
              )
              let projectSettingsPayload: ReturnType<
                typeof projectConfigurationToSettingsPayload
              > = {}
              if (!err(parsedProjectSettings)) {
                projectSettingsPayload = projectConfigurationToSettingsPayload(
                  parsedProjectSettings
                )
              }

              return {
                sampleName: data.sample,
                code,
                method: data.method,
                sampleUnits:
                  projectSettingsPayload.modeling?.defaultUnit || 'mm',
              }
            }
          )
          .then((props) => {
            if (props?.code) {
              onSubmit(props).catch(reportError)
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
          options: providedOptions,
        },
      },
    },
  ]
}
