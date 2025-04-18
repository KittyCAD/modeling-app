import type { UnitLength_type } from '@kittycad/lib/dist/types/src/models'
import toast from 'react-hot-toast'

import { CommandBarOverwriteWarning } from '@src/components/CommandBarOverwriteWarning'
import { DEV } from '@src/env'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import { addImportAndInsert } from '@src/lang/modifyAst'
import {
  changeKclSettings,
  unitAngleToUnitAng,
  unitLengthToUnitLen,
} from '@src/lang/wasm'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import {
  DEFAULT_DEFAULT_ANGLE_UNIT,
  DEFAULT_DEFAULT_LENGTH_UNIT,
  EXECUTION_TYPE_REAL,
  FILE_EXT,
} from '@src/lib/constants'
import { getPathFilenameInVariableCase } from '@src/lib/desktop'
import { isDesktop } from '@src/lib/isDesktop'
import { copyFileShareLink } from '@src/lib/links'
import { baseUnitsUnion } from '@src/lib/settings/settingsTypes'
import { codeManager, editorManager, kclManager } from '@src/lib/singletons'
import { err, reportRejection } from '@src/lib/trap'
import type { IndexLoaderData } from '@src/lib/types'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import { IS_NIGHTLY_OR_DEBUG } from '@src/routes/utils'

interface OnSubmitProps {
  name: string
  content?: string
  targetPathToClone?: string
  method: 'overwrite' | 'newFile'
  source: 'kcl-samples' | 'local'
}

interface KclCommandConfig {
  // TODO: find a different approach that doesn't require
  // special props for a single command
  specialPropsForLoadCommand: {
    onSubmit: (p: OnSubmitProps) => Promise<void>
    providedOptions: CommandArgumentOption<string>[]
  }
  specialPropsForInsertCommand: {
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
      name: 'Insert',
      description: 'Insert from a file in the current project directory',
      icon: 'import',
      groupId: 'code',
      hide: DEV || IS_NIGHTLY_OR_DEBUG ? 'web' : 'both',
      needsReview: true,
      reviewMessage:
        'Reminder: point-and-click insert is in development and only supports one part instance per assembly.',
      args: {
        path: {
          inputType: 'options',
          required: true,
          options: commandProps.specialPropsForInsertCommand.providedOptions,
        },
        localName: {
          inputType: 'string',
          required: true,
          defaultValue: (context: CommandBarContext) => {
            if (!context.argumentsToSubmit['path']) {
              return
            }

            const path = context.argumentsToSubmit['path'] as string
            return getPathFilenameInVariableCase(path)
          },
        },
      },
      onSubmit: (data) => {
        if (!data) {
          return new Error('No input provided')
        }

        const ast = kclManager.ast
        const { path, localName } = data
        const { modifiedAst, pathToImportNode, pathToInsertNode } =
          addImportAndInsert({
            node: ast,
            path,
            localName,
          })
        updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          { kclManager, editorManager, codeManager },
          {
            focusPath: [pathToImportNode, pathToInsertNode],
          }
        ).catch(reportRejection)
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
      name: 'load-external-model',
      displayName: 'Load external model',
      description:
        'Loads a model from an external source into the current project.',
      needsReview: true,
      icon: 'importFile',
      reviewMessage: ({ argumentsToSubmit }) =>
        argumentsToSubmit['method'] === 'overwrite'
          ? CommandBarOverwriteWarning({
              heading: 'Overwrite current file with sample?',
              message:
                'This will erase your current file and load the sample part.',
            })
          : 'This will create a new file in the current project and open it.',
      groupId: 'code',
      onSubmit(data) {
        if (!data) {
          return new Error('No input data')
        }

        const { method, source, sample, path } = data
        if (source === 'local' && path) {
          commandProps.specialPropsForLoadCommand
            .onSubmit({
              name: '',
              targetPathToClone: path,
              method,
              source,
            })
            .catch(reportError)
        } else if (source === 'kcl-samples' && sample) {
          const pathParts = sample.split('/')
          const projectPathPart = pathParts[0]
          const primaryKclFile = pathParts[1]
          // local only
          const sampleCodeUrl =
            (isDesktop() ? '.' : '') +
            `/kcl-samples/${encodeURIComponent(
              projectPathPart
            )}/${encodeURIComponent(primaryKclFile)}`

          fetch(sampleCodeUrl)
            .then(async (codeResponse) => {
              if (!codeResponse.ok) {
                console.error(
                  'Failed to fetch sample code:',
                  codeResponse.statusText
                )
                return Promise.reject(new Error('Failed to fetch sample code'))
              }
              const code = await codeResponse.text()
              commandProps.specialPropsForLoadCommand
                .onSubmit({
                  name: data.sample.split('/')[0] + FILE_EXT,
                  content: code,
                  source,
                  method,
                })
                .catch(reportError)
            })
            .catch(reportError)
        } else {
          toast.error("The command couldn't be submitted, check the arguments.")
        }
      },
      args: {
        source: {
          inputType: 'options',
          required: true,
          skip: false,
          defaultValue: 'local',
          hidden: !isDesktop(),
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
        method: {
          inputType: 'options',
          skip: true,
          required: (commandContext) =>
            !['local'].includes(
              commandContext.argumentsToSubmit.source as string
            ),
          hidden: (commandContext) =>
            ['local'].includes(
              commandContext.argumentsToSubmit.source as string
            ),
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
          required: (commandContext) =>
            !['local'].includes(
              commandContext.argumentsToSubmit.source as string
            ),
          hidden: (commandContext) =>
            ['local'].includes(
              commandContext.argumentsToSubmit.source as string
            ),
          valueSummary(value) {
            const MAX_LENGTH = 12
            if (typeof value === 'string') {
              return value.length > MAX_LENGTH
                ? value.substring(0, MAX_LENGTH) + '...'
                : value
            }
            return value
          },
          options: commandProps.specialPropsForLoadCommand.providedOptions,
        },
        path: {
          inputType: 'path',
          valueSummary: (value) => window.electron.path.basename(value),
          required: (commandContext) =>
            ['local'].includes(
              commandContext.argumentsToSubmit.source as string
            ),
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
