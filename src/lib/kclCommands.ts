import type { UnitLength } from '@kittycad/lib'
import toast from 'react-hot-toast'

import { updateModelingState } from '@src/lang/modelingWorkflows'
import { addModuleImport, insertNamedConstant } from '@src/lang/modifyAst'
import {
  changeKclSettings,
  isPathToNode,
  type PathToNode,
  type SourceRange,
  type VariableDeclarator,
} from '@src/lang/wasm'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import {
  DEFAULT_DEFAULT_EXPERIMENTAL_FEATURES,
  DEFAULT_DEFAULT_LENGTH_UNIT,
  EXECUTION_TYPE_REAL,
} from '@src/lib/constants'
import { getPathFilenameInVariableCase } from '@src/lib/desktop'
import { copyFileShareLink } from '@src/lib/links'
import { baseUnitsUnion } from '@src/lib/settings/settingsTypes'
import {
  codeManager,
  editorManager,
  kclManager,
  rustContext,
} from '@src/lib/singletons'
import { err, reportRejection } from '@src/lib/trap'
import type { IndexLoaderData } from '@src/lib/types'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import { getNodeFromPath } from '@src/lang/queryAst'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { getVariableDeclaration } from '@src/lang/queryAst/getVariableDeclaration'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'

interface KclCommandConfig {
  // TODO: find a different approach that doesn't require
  // special props for a single command
  specialPropsForInsertCommand: {
    providedOptions: CommandArgumentOption<string>[]
  }
  projectData: IndexLoaderData
  authToken: string
  settings: {
    defaultUnit: UnitLength
  }
  isRestrictedToOrg?: boolean
  password?: string
}

const NO_INPUT_PROVIDED_MESSAGE = 'No input provided'

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
          const newCode = changeKclSettings(
            codeManager.code,
            data.unit,
            kclManager.fileSettings.defaultLengthUnit ??
              DEFAULT_DEFAULT_LENGTH_UNIT
          )
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
      name: 'set-file-experimental-features',
      displayName: 'Set experimental features flag',
      description: 'Set the experimental features flag in the current file.',
      needsReview: false,
      groupId: 'code',
      icon: 'code',
      args: {
        flag: {
          required: true,
          inputType: 'options',
          defaultValue:
            kclManager.fileSettings.experimentalFeatures?.type.toLowerCase() ||
            DEFAULT_DEFAULT_EXPERIMENTAL_FEATURES,
          options: () =>
            Object.values(['allow', 'deny', 'warn']).map((v) => {
              return {
                name: v,
                value: v,
                isCurrent: kclManager.fileSettings.experimentalFeatures
                  ? v ===
                    kclManager.fileSettings.experimentalFeatures?.type.toLowerCase()
                  : v === DEFAULT_DEFAULT_LENGTH_UNIT,
              }
            }),
        },
      },
      onSubmit: (data) => {
        if (typeof data === 'object' && 'flag' in data) {
          const newCode = changeKclSettings(
            codeManager.code,
            kclManager.fileSettings.defaultLengthUnit ??
              DEFAULT_DEFAULT_LENGTH_UNIT,
            data.flag
          )
          if (err(newCode)) {
            toast.error(
              `Failed to set experimental features flag: ${newCode.message}`
            )
          } else {
            codeManager.updateCodeStateEditor(newCode)
            Promise.all([codeManager.writeToFile(), kclManager.executeCode()])
              .then(() => {
                toast.success(
                  `Updated experimental features flag to ${data.flag}`
                )
              })
              .catch(reportRejection)
          }
        } else {
          toast.error(
            'Failed to set experimental features flag: no value provided to submit function. This is a bug.'
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
            const variableExists =
              kclManager.variables['__mod_' + data.localName]
            if (variableExists) {
              return 'This variable name is already in use.'
            }

            return true
          },
        },
      },
      onSubmit: (data) => {
        if (!data) {
          return new Error(NO_INPUT_PROVIDED_MESSAGE)
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
          { kclManager, editorManager, codeManager, rustContext },
          {
            focusPath: [pathToNode],
            skipErrorsOnMockExecution: true,
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
      onSubmit: (input) => {
        copyFileShareLink({
          token: commandProps.authToken,
          code: codeManager.code,
          name: commandProps.projectData.project?.name || '',
          isRestrictedToOrg: input?.event.data.isRestrictedToOrg ?? false,
          password: input?.event.data.password,
        }).catch(reportRejection)
      },
    },
    {
      name: 'parameter.create',
      displayName: 'Create parameter',
      description: 'Add a named constant to use in geometry',
      groupId: 'code',
      icon: 'make-variable',
      needsReview: false,
      args: {
        value: {
          inputType: 'kcl',
          required: true,
          createVariable: 'force',
          variableName: 'myParameter',
          defaultValue: '5',
        },
      },
      onSubmit: (data) => {
        if (!data) {
          return new Error(NO_INPUT_PROVIDED_MESSAGE)
        }

        const { value } = data
        if (!('variableName' in value)) {
          return new Error('variable name is required')
        }
        const newAst = insertNamedConstant({
          node: kclManager.ast,
          newExpression: value,
        })
        updateModelingState(newAst, EXECUTION_TYPE_REAL, {
          kclManager,
          editorManager,
          codeManager,
          rustContext,
        }).catch(reportRejection)
      },
    },
    {
      name: 'parameter.edit',
      displayName: 'Edit parameter',
      description: 'Edit the value of a named constant',
      groupId: 'code',
      icon: 'make-variable',
      needsReview: false,
      args: {
        nodeToEdit: {
          displayName: 'Name',
          inputType: 'options',
          valueSummary: (nodeToEdit: PathToNode) => {
            const node = getNodeFromPath<VariableDeclarator>(
              kclManager.ast,
              nodeToEdit,
              'VariableDeclarator',
              true
            )
            if (err(node) || node.node.type !== 'VariableDeclarator')
              return 'Error'
            return node.node.id.name || ''
          },
          required: true,
          options() {
            return (
              Object.entries(kclManager.execState.variables)
                // TODO: @franknoirot && @jtran would love to make this go away soon 🥺
                .filter(([_, variable]) => variable?.type === 'Number')
                .map(([name, _variable]) => {
                  const node = getVariableDeclaration(kclManager.ast, name)
                  if (node === undefined) return
                  const range: SourceRange = [
                    node.start,
                    node.end,
                    node.moduleId,
                  ]
                  const pathToNode = getNodePathFromSourceRange(
                    kclManager.ast,
                    range
                  )
                  return {
                    name,
                    value: pathToNode,
                  }
                })
                .filter((a) => !!a) || []
            )
          },
        },
        value: {
          inputType: 'kcl',
          required: true,
          defaultValue(commandBarContext) {
            const nodeToEdit = commandBarContext.argumentsToSubmit.nodeToEdit
            if (!nodeToEdit || !isPathToNode(nodeToEdit)) return '5'
            const node = getNodeFromPath<VariableDeclarator>(
              kclManager.ast,
              nodeToEdit
            )
            if (err(node) || node.node.type !== 'VariableDeclarator')
              return 'Error'
            const variableName = node.node.id.name || ''
            if (typeof variableName !== 'string') return '5'
            const variableNode = getVariableDeclaration(
              kclManager.ast,
              variableName
            )
            if (!variableNode) return '5'
            const code = codeManager.code.slice(
              variableNode.declaration.init.start,
              variableNode.declaration.init.end
            )
            return code
          },
          createVariable: 'disallow',
        },
      },
      onSubmit: (data) => {
        if (!data) {
          return new Error(NO_INPUT_PROVIDED_MESSAGE)
        }

        // Get the variable AST node to edit
        const { nodeToEdit, value } = data
        const newAst = structuredClone(kclManager.ast)
        const variableNode = getNodeFromPath<Node<VariableDeclarator>>(
          newAst,
          nodeToEdit
        )

        if (
          err(variableNode) ||
          variableNode.node.type !== 'VariableDeclarator' ||
          !variableNode.node
        ) {
          return new Error('No variable found, this is a bug')
        }

        // Mutate the variable's value
        variableNode.node.init = value.valueAst

        updateModelingState(newAst, EXECUTION_TYPE_REAL, {
          codeManager,
          editorManager,
          kclManager,
          rustContext,
        }).catch(reportRejection)
      },
    },
  ]
}
