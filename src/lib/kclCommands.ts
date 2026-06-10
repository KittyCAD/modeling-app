import type { UnitLength } from '@kittycad/lib'
import toast from 'react-hot-toast'

import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { ExecutingEditor } from '@src/lang/ExecutingEditor'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import {
  addModuleImport,
  insertVariableAndOffsetPathToNode,
} from '@src/lang/modifyAst'
import { setExperimentalFeatures } from '@src/lang/modifyAst/settings'
import { getNodeFromPath } from '@src/lang/queryAst'
import { getVariableDeclaration } from '@src/lang/queryAst/getVariableDeclaration'
import {
  type PathToNode,
  type VariableDeclarator,
  changeDefaultUnits,
  getAllOperations,
  isPathToNode,
  pathToNodeFromRustNodePath,
  recast,
} from '@src/lang/wasm'
import { relevantFileExtensions } from '@src/lang/wasmUtils'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  DEFAULT_EXPERIMENTAL_FEATURES,
  EXECUTION_TYPE_REAL,
} from '@src/lib/constants'
import { getPathFilenameInVariableCase } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import { copyFileShareLink } from '@src/lib/links'
import type { Project } from '@src/lib/project'
import { baseUnitsUnion, warningLevels } from '@src/lib/settings/settingsTypes'
import { err, reportRejection } from '@src/lib/trap'
import type { IndexLoaderData } from '@src/lib/types'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import { listAllImportFilesWithinProject } from '@src/machines/systemIO/snapshotContext'
import type { SystemIOActor } from '@src/machines/systemIO/utils'

interface KclCommandConfig {
  // TODO: find a different approach that doesn't require
  // special props for a single command
  specialPropsForInsertCommand: {
    providedOptions: ReadonlyArray<CommandArgumentOption<string>>
  }
  executingEditor: ExecutingEditor
  systemIOActor: SystemIOActor
  wasmInstance: ModuleType
  projectData: IndexLoaderData
  authToken: string
  settings: {
    defaultUnit: UnitLength
  }
  isRestrictedToOrg?: boolean
  password?: string
  project?: Project
}

const NO_INPUT_PROVIDED_MESSAGE = 'No input provided'
const EXECUTING_MESSAGE =
  'Cannot run command while code is executing. Please try again later.'

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
            commandProps.executingEditor.fileSettings.defaultLengthUnit ||
            DEFAULT_DEFAULT_LENGTH_UNIT,
          options: () =>
            Object.values(baseUnitsUnion).map((v) => {
              return {
                name: v,
                value: v,
                isCurrent: commandProps.executingEditor.fileSettings
                  .defaultLengthUnit
                  ? v ===
                    commandProps.executingEditor.fileSettings.defaultLengthUnit
                  : v === DEFAULT_DEFAULT_LENGTH_UNIT,
              }
            }),
        },
      },
      onSubmit: (data) => {
        if (typeof data === 'object' && 'unit' in data) {
          const newCode = changeDefaultUnits(
            commandProps.executingEditor.code,
            data.unit,
            commandProps.wasmInstance
          )
          if (err(newCode)) {
            toast.error(`Failed to set per-file units: ${newCode.message}`)
          } else {
            commandProps.executingEditor.updateCodeEditor(newCode, {
              shouldExecute: true,
              shouldResetCamera: true,
            })
            toast.success(`Updated per-file units to ${data.unit}.`)
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
        level: {
          required: true,
          inputType: 'options',
          defaultValue:
            commandProps.executingEditor.fileSettings.experimentalFeatures
              ?.type || DEFAULT_EXPERIMENTAL_FEATURES.type,
          options: () =>
            warningLevels.map((l) => {
              return {
                name: l.type,
                value: l.type,
                isCurrent: commandProps.executingEditor.fileSettings
                  .experimentalFeatures
                  ? l.type ===
                    commandProps.executingEditor.fileSettings
                      .experimentalFeatures.type
                  : l.type === DEFAULT_EXPERIMENTAL_FEATURES.type,
              }
            }),
        },
      },
      onSubmit: (data) => {
        awaitWasmAndSubmit().catch(reportRejection)

        async function awaitWasmAndSubmit() {
          if (typeof data === 'object' && 'level' in data) {
            const newAst = setExperimentalFeatures(
              commandProps.executingEditor.code,
              {
                type: data.level,
              },
              await commandProps.executingEditor.wasmInstancePromise
            )
            if (err(newAst)) {
              toast.error(
                `Failed to set file experimental features level: ${newAst.message}`
              )
              return
            }
            updateModelingState(
              newAst,
              EXECUTION_TYPE_REAL,
              commandProps.executingEditor
            )
              .then((result) => {
                if (err(result)) {
                  toast.error(
                    `Failed to set file experimental features level: ${result.message}`
                  )
                  return
                }

                toast.success(
                  `Updated file experimental features level to ${data.level}.`
                )
              })
              .catch(reportRejection)
          } else {
            toast.error(
              'Failed to set experimental features level: no value provided to submit function. This is a bug.'
            )
          }
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
      reviewValidation: async () => {
        if (commandProps.executingEditor.isExecuting) {
          return new Error(EXECUTING_MESSAGE)
        }
      },
      args: {
        path: {
          inputType: 'options',
          required: true,
          options: () => {
            const providedOptions: { name: string; value: string }[] = []
            const context = commandProps.systemIOActor.getSnapshot().context
            const projectName = commandProps.project?.name
            const sep = fsZds.sep
            const relevantFiles = relevantFileExtensions(
              commandProps.wasmInstance
            )
            if (projectName && sep) {
              const importableFiles = listAllImportFilesWithinProject(context, {
                projectFolderName: projectName,
                importExtensions: relevantFiles,
              })
              importableFiles.forEach((file) => {
                providedOptions.push({
                  name: file.replaceAll(sep, '/'),
                  value: file.replaceAll(sep, '/'),
                })
              })
            }
            return providedOptions
          },
          validation: async ({ data }) => {
            const importExists = commandProps.executingEditor.ast.body.find(
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
              commandProps.executingEditor.variables['__mod_' + data.localName]
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

        const ast = commandProps.executingEditor.ast
        const { path, localName } = data
        const { modifiedAst, pathToNode } = addModuleImport({
          ast,
          path,
          localName,
        })
        updateModelingState(
          modifiedAst,
          EXECUTION_TYPE_REAL,
          commandProps.executingEditor,
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
        commandProps.executingEditor.format().catch(reportRejection)
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
          code: commandProps.executingEditor.code,
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
      onSubmit: async (data) => {
        if (!data) {
          return new Error(NO_INPUT_PROVIDED_MESSAGE)
        }

        const { value } = data
        if (!('variableName' in value)) {
          return new Error('variable name is required')
        }
        if (
          !('insertIndex' in value) ||
          typeof value.insertIndex !== 'number'
        ) {
          return new Error('insert index is required')
        }
        if (!('valueText' in value) || typeof value.valueText !== 'string') {
          return new Error('value text is required')
        }
        if (!('variableDeclarationAst' in value)) {
          return new Error('variable declaration is required')
        }

        const freshAst = await commandProps.executingEditor.safeParse(
          commandProps.executingEditor.code,
          commandProps.executingEditor.wasmInstancePromise
        )
        if (!freshAst) {
          return new Error('Current code could not be parsed')
        }

        const modifiedAst = structuredClone(freshAst)
        insertVariableAndOffsetPathToNode(value, modifiedAst)

        const newCode = recast(
          modifiedAst,
          await commandProps.executingEditor.wasmInstancePromise
        )
        if (err(newCode)) {
          return new Error(`Failed to create parameter: ${newCode.message}`)
        }

        commandProps.executingEditor.updateCodeEditor(newCode, {
          shouldExecute: true,
          shouldWriteToDisk: true,
          shouldAddToHistory: true,
        })
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
              commandProps.executingEditor.ast,
              nodeToEdit,
              commandProps.wasmInstance,
              'VariableDeclarator',
              true
            )
            if (err(node) || node.node.type !== 'VariableDeclarator')
              return 'Error'
            return node.node.id.name || ''
          },
          required: true,
          options() {
            return getAllOperations(
              commandProps.executingEditor.execState.operations
            ).flatMap((op) => {
              if (op.type !== 'VariableDeclaration') return []
              if (op.value.type !== 'Number') return []
              const value = pathToNodeFromRustNodePath(op.nodePath).slice(0, -1)
              return { name: op.name, value }
            })
          },
        },
        value: {
          inputType: 'kcl',
          required: true,
          defaultValue(commandBarContext) {
            const nodeToEdit = commandBarContext.argumentsToSubmit.nodeToEdit
            if (!nodeToEdit || !isPathToNode(nodeToEdit)) return '5'
            const node = getNodeFromPath<VariableDeclarator>(
              commandProps.executingEditor.ast,
              nodeToEdit,
              commandProps.wasmInstance,
              'VariableDeclarator'
            )
            if (err(node) || node.node.type !== 'VariableDeclarator')
              return 'Error'
            const variableName = node.node.id.name || ''
            if (typeof variableName !== 'string') return '5'
            const variableNode = getVariableDeclaration(
              commandProps.executingEditor.ast,
              variableName
            )
            if (!variableNode) return '5'
            const code = commandProps.executingEditor.code.slice(
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
        const newAst = structuredClone(commandProps.executingEditor.ast)
        const variableNode = getNodeFromPath<Node<VariableDeclarator>>(
          newAst,
          nodeToEdit,
          commandProps.wasmInstance
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

        updateModelingState(
          newAst,
          EXECUTION_TYPE_REAL,
          commandProps.executingEditor
        ).catch(reportRejection)
      },
    },
  ]
}
