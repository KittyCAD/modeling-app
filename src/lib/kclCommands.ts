import { CommandBarOverwriteWarning } from 'components/CommandBarOverwriteWarning'
import { Command, CommandArgumentOption } from './commandTypes'
import { codeManager, kclManager } from './singletons'
import { isDesktop } from './isDesktop'
import { FILE_EXT } from './constants'
import { UnitLength_type } from '@kittycad/lib/dist/types/src/models'
import { err, reportRejection } from './trap'
import { IndexLoaderData } from './types'
import { IS_NIGHTLY_OR_DEBUG } from 'routes/Settings'
import { copyFileShareLink } from './links'
import { changeKclSettings, unitLengthToUnitLen } from 'lang/wasm'
import toast from 'react-hot-toast'

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

        fetch(sampleCodeUrl)
          .then(async (codeResponse): Promise<OnSubmitProps> => {
            if (!codeResponse.ok) {
              console.error(
                'Failed to fetch sample code:',
                codeResponse.statusText
              )
              return Promise.reject(new Error('Failed to fetch sample code'))
            }
            const code = await codeResponse.text()
            return {
              sampleName: data.sample.split('/')[0] + FILE_EXT,
              code,
              method: data.method,
            }
          })
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
    {
      name: 'share-file-link',
      displayName: 'Share current part (via Zoo link)',
      hide: IS_NIGHTLY_OR_DEBUG ? undefined : 'desktop',
      description: 'Create a link that contains a copy of the current file.',
      groupId: 'code',
      needsReview: false,
      icon: 'link',
      onSubmit: () => {
        copyFileShareLink({
          token: commandProps.authToken,
          code: codeManager.code,
          name: commandProps.projectData.project?.name || '',
        }).catch(reportRejection)
      },
    },
    {
      name: 'change-length-units',
      displayName: `Set file's default length unit`,
      description: `Change the length unit to be used unless overriden inline`,
      groupId: 'code',
      needsReview: false,
      icon: 'dimension',
      args: {
        unit: {
          inputType: 'options',
          required: true,
          options: () => {
            const current = kclManager.fileSettings.defaultLengthUnit
            return [
              { value: 'mm', name: 'Millimeters', isCurrent: current === 'mm' },
              { value: 'cm', name: 'Centimeters', isCurrent: current === 'cm' },
              { value: 'm', name: 'Meters', isCurrent: current === 'm' },
              { value: 'in', name: 'Inches', isCurrent: current === 'in' },
              { value: 'ft', name: 'Feet', isCurrent: current === 'ft' },
              { value: 'yd', name: 'Yards', isCurrent: current === 'yd' },
            ]
          },
          defaultValue: commandProps.settings.defaultUnit,
        },
      },
      onSubmit: (data) => {
        if (!(data?.unit && commandProps.projectData.file)) {
          return
        }

        const codeToWrite = changeKclSettings(codeManager.code, {
          defaultLengthUnits: unitLengthToUnitLen(data.unit),
          defaultAngleUnits: { type: 'Degrees' },
        })
        if (err(codeToWrite)) return Promise.reject(codeToWrite)
        codeManager.updateCodeStateEditor(codeToWrite)
        codeManager
          .writeToFile()
          .then(() => {
            kclManager.executeCode(true)
          })
          .then(() => {
            toast.success(`Updated per-file units to ${data.unit}`)
          })
          .catch(reportRejection)
      },
    },
  ]
}
