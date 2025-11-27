import type { UnitLength } from '@kittycad/lib'
import toast from 'react-hot-toast'

import { updateModelingState } from '@src/lang/modelingWorkflows'
import { addModuleImport, insertNamedConstant } from '@src/lang/modifyAst'
import {
  changeDefaultUnits,
  isPathToNode,
  pathToNodeFromRustNodePath,
  type PathToNode,
  type VariableDeclarator,
} from '@src/lang/wasm'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import {
  DEFAULT_EXPERIMENTAL_FEATURES,
  DEFAULT_DEFAULT_LENGTH_UNIT,
  EXECUTION_TYPE_REAL,
} from '@src/lib/constants'
import { getPathFilenameInVariableCase } from '@src/lib/desktop'
import { copyFileShareLink } from '@src/lib/links'
import { baseUnitsUnion, warningLevels } from '@src/lib/settings/settingsTypes'
import {
  editorManager,
  kclManager,
  rustContext,
  systemIOActor,
} from '@src/lib/singletons'
import { err, reportRejection } from '@src/lib/trap'
import type { IndexLoaderData } from '@src/lib/types'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import { getNodeFromPath } from '@src/lang/queryAst'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { getVariableDeclaration } from '@src/lang/queryAst/getVariableDeclaration'
import { setExperimentalFeatures } from '@src/lang/modifyAst/settings'
import { listAllImportFilesWithinProject } from '@src/machines/systemIO/snapshotContext'
import type { Project } from '@src/lib/project'
import { relevantFileExtensions } from '@src/lang/wasmUtils'

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
  project?: Project
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
          const newCode = changeDefaultUnits(editorManager.code, data.unit)
          if (err(newCode)) {
            toast.error(`Failed to set per-file units: ${newCode.message}`)
          } else {
            editorManager.updateCodeStateEditor(newCode)
            Promise.all([editorManager.writeToFile(), kclManager.executeCode()])
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
        level: {
          required: true,
          inputType: 'options',
          defaultValue:
            kclManager.fileSettings.experimentalFeatures?.type ||
            DEFAULT_EXPERIMENTAL_FEATURES.type,
          options: () =>
            warningLevels.map((l) => {
              return {
                name: l.type,
                value: l.type,
                isCurrent: kclManager.fileSettings.experimentalFeatures
                  ? l.type === kclManager.fileSettings.experimentalFeatures.type
                  : l.type === DEFAULT_EXPERIMENTAL_FEATURES.type,
              }
            }),
        },
      },
      onSubmit: (data) => {
        if (typeof data === 'object' && 'level' in data) {
          const newAst = setExperimentalFeatures(editorManager.code, {
            type: data.level,
          })
          if (err(newAst)) {
            toast.error(
              `Failed to set file experimental features level: ${newAst.message}`
            )
            return
          }
          updateModelingState(newAst, EXECUTION_TYPE_REAL, {
            kclManager,
            editorManager,
            rustContext,
          })
            .then((result) => {
              if (err(result)) {
                toast.error(
                  `Failed to set file experimental features level: ${result.message}`
                )
                return
              }

              toast.success(
                `Updated file experimental features level to ${data.level}`
              )
            })
            .catch(reportRejection)
        } else {
          toast.error(
            'Failed to set experimental features level: no value provided to submit function. This is a bug.'
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
          options: () => {
            const providedOptions: { name: string; value: string }[] = []
            const context = systemIOActor.getSnapshot().context
            const projectName = commandProps.project?.name
            const sep = window.electron?.sep
            const relevantFiles = relevantFileExtensions()
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
          {
            kclManager,
            editorManager,
            rustContext,
          },
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
          code: editorManager.code,
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
            return kclManager.execState.operations.flatMap((op) => {
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
            const code = editorManager.code.slice(
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
          editorManager,
          kclManager,
          rustContext,
        }).catch(reportRejection)
      },
    },
  ]
}
