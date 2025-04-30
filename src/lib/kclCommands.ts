import type { UnitLength_type } from '@kittycad/lib/dist/types/src/models'
import toast from 'react-hot-toast'

import { updateModelingState } from '@src/lang/modelingWorkflows'
import { addModuleImport } from '@src/lang/modifyAst'
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
} from '@src/lib/constants'
import { getPathFilenameInVariableCase } from '@src/lib/desktop'
import { copyFileShareLink } from '@src/lib/links'
import { baseUnitsUnion } from '@src/lib/settings/settingsTypes'
import { codeManager, editorManager, kclManager } from '@src/lib/singletons'
import { err, reportRejection } from '@src/lib/trap'
import type { IndexLoaderData } from '@src/lib/types'
import type { CommandBarContext } from '@src/machines/commandBarMachine'

interface KclCommandConfig {
  // TODO: find a different approach that doesn't require
  // special props for a single command
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
      hide: 'web',
      needsReview: true,
      reviewMessage:
        'Reminder: point-and-click insert is in development and only supports one part instance per assembly.',
      args: {
        path: {
          inputType: 'options',
          required: true,
          options: commandProps.specialPropsForInsertCommand.providedOptions,
          validation: async ({ data }) => {
            const importExists = kclManager.ast.body.find(
              (n) =>
                n.type === 'ImportStatement' &&
                ((n.path.type === 'Kcl' && n.path.filename === data.path) ||
                  (n.path.type === 'Foreign' && n.path.path === data.path))
            )
            if (importExists) {
              return 'This file is already imported, use the Clone command instead.'
              // TODO: see if we can transition to the clone command, see #6515
            }

            return true
          },
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
          validation: async ({ data }) => {
            const variableExists = kclManager.variables[data.localName]
            if (variableExists) {
              return 'This variable name is already in use.'
            }

            return true
          },
        },
      },
      onSubmit: (data) => {
        if (!data) {
          return new Error('No input provided')
        }

        const ast = kclManager.ast
        const { path, localName } = data
        const { modifiedAst, pathToNode } = addModuleImport({
          ast,
          path,
          localName,
        })
        updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          { kclManager, editorManager, codeManager },
          {
            focusPath: [pathToNode],
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
      name: 'share-file-link',
      displayName: 'Share part via Zoo link',
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
