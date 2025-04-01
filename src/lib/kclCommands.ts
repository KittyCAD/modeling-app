import { UnitLength_type } from '@kittycad/lib/dist/types/src/models'
import { CommandBarOverwriteWarning } from 'components/CommandBarOverwriteWarning'
import {
  changeKclSettings,
  unitAngleToUnitAng,
  unitLengthToUnitLen,
} from 'lang/wasm'
import toast from 'react-hot-toast'

import { Command, CommandArgumentOption } from './commandTypes'
import {
  DEFAULT_DEFAULT_ANGLE_UNIT,
  DEFAULT_DEFAULT_LENGTH_UNIT,
  FILE_EXT,
} from './constants'
import { isDesktop } from './isDesktop'
import { copyFileShareLink } from './links'
import { baseUnitsUnion } from './settings/settingsTypes'
import { codeManager, kclManager } from './singletons'
import { err, reportRejection } from './trap'
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
      name: 'set-file-units',
      displayName: 'Set file units',
      description:
        'Set the length unit for all dimensions not given explicit units in the current file.',
      needsReview: false,
      groupId: 'code',
      icon: 'code',
      args: {
        unit: {
          required: true,
          inputType: 'options',
          defaultValue:
            kclManager.fileSettings.defaultLengthUnit ||
            DEFAULT_DEFAULT_LENGTH_UNIT,
          options: () =>
            Object.values(baseUnitsUnion).map((v) => {
              return {
                name: v,
                value: v,
                isCurrent: kclManager.fileSettings.defaultLengthUnit
                  ? v === kclManager.fileSettings.defaultLengthUnit
                  : v === DEFAULT_DEFAULT_LENGTH_UNIT,
              }
            }),
        },
      },
      onSubmit: (data) => {
        if (typeof data === 'object' && 'unit' in data) {
          const newCode = changeKclSettings(codeManager.code, {
            defaultLengthUnits: unitLengthToUnitLen(data.unit),
            defaultAngleUnits: unitAngleToUnitAng(
              kclManager.fileSettings.defaultAngleUnit ??
                DEFAULT_DEFAULT_ANGLE_UNIT
            ),
          })
          if (err(newCode)) {
            toast.error(`Failed to set per-file units: ${newCode.message}`)
          } else {
            codeManager.updateCodeStateEditor(newCode)
            Promise.all([codeManager.writeToFile(), kclManager.executeCode()])
              .then(() => {
                toast.success(`Updated per-file units to ${data.unit}`)
              })
              .catch(reportRejection)
          }
        } else {
          toast.error(
            'Failed to set per-file units: no value provided to submit function. This is a bug.'
          )
        }
      },
    },
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
        CommandBarOverwriteWarning({
          heading:
            'method' in argumentsToSubmit &&
            argumentsToSubmit.method === 'newFile'
              ? 'Create a new file from sample?'
              : 'Overwrite current file with sample?',
          message:
            'method' in argumentsToSubmit &&
            argumentsToSubmit.method === 'newFile'
              ? 'This will create a new file in the current project and open it.'
              : 'This will erase your current file and load the sample part.',
        }),
      groupId: 'code',
      onSubmit(data) {
        if (!data?.sample) {
          return
        }
        const pathParts = data.sample.split('/')
        const projectPathPart = pathParts[0]
        const primaryKclFile = pathParts[1]
        // local only
        const sampleCodeUrl =
          (isDesktop() ? '.' : '') +
          `/kcl-samples/${encodeURIComponent(
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
  ]
}
