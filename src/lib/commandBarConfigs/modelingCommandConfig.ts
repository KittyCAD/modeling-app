import type { Models } from '@kittycad/lib'

import { angleLengthInfo } from '@src/components/Toolbar/angleLengthInfo'
import { findUniqueName } from '@src/lang/create'
import { getNodeFromPath } from '@src/lang/queryAst'
import { getVariableDeclaration } from '@src/lang/queryAst/getVariableDeclaration'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { transformAstSketchLines } from '@src/lang/std/sketchcombos'
import type {
  PathToNode,
  SourceRange,
  VariableDeclarator,
} from '@src/lang/wasm'
import { isPathToNode } from '@src/lang/wasm'
import type {
  KclCommandValue,
  StateMachineCommandSetConfig,
} from '@src/lib/commandTypes'
import {
  IS_ML_EXPERIMENTAL,
  KCL_DEFAULT_CONSTANT_PREFIXES,
  KCL_DEFAULT_DEGREE,
  KCL_DEFAULT_LENGTH,
  KCL_DEFAULT_TRANSFORM,
} from '@src/lib/constants'
import type { components } from '@src/lib/machine-api'
import type { Selections } from '@src/lib/selections'
import { codeManager, kclManager } from '@src/lib/singletons'
import { err } from '@src/lib/trap'
import type { SketchTool, modelingMachine } from '@src/machines/modelingMachine'

type OutputFormat = Models['OutputFormat3d_type']
type OutputTypeKey = OutputFormat['type']
type ExtractStorageTypes<T> = T extends { storage: infer U } ? U : never
type StorageUnion = ExtractStorageTypes<OutputFormat>

export const EXTRUSION_RESULTS = [
  'new',
  'add',
  'subtract',
  'intersect',
] as const

export const COMMAND_APPEARANCE_COLOR_DEFAULT = 'default'

export type HelixModes = 'Axis' | 'Edge' | 'Cylinder'

export type ModelingCommandSchema = {
  'Enter sketch': { forceNewSketch?: boolean }
  Export: {
    type: OutputTypeKey
    storage?: StorageUnion
  }
  Make: {
    machine: components['schemas']['MachineInfoResponse']
  }
  Extrude: {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // KCL stdlib arguments
    sketches: Selections
    length: KclCommandValue
  }
  Sweep: {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // KCL stdlib arguments
    sketches: Selections
    path: Selections
    sectional?: boolean
  }
  Loft: {
    sketches: Selections
  }
  Revolve: {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // Flow arg
    axisOrEdge: 'Axis' | 'Edge'
    // KCL stdlib arguments
    sketches: Selections
    angle: KclCommandValue
    axis: string | undefined
    edge: Selections | undefined
  }
  Shell: {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // KCL stdlib arguments
    selection: Selections
    thickness: KclCommandValue
  }
  Fillet: {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // KCL stdlib arguments
    selection: Selections
    radius: KclCommandValue
  }
  Chamfer: {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // KCL stdlib arguments
    selection: Selections
    length: KclCommandValue
  }
  'Offset plane': {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    plane: Selections
    distance: KclCommandValue
  }
  Helix: {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // Flow arg
    mode: HelixModes
    // Three different arguments depending on mode
    axis?: string
    edge?: Selections
    cylinder?: Selections
    // KCL stdlib arguments
    revolutions: KclCommandValue
    angleStart: KclCommandValue
    radius?: KclCommandValue // axis or edge modes only
    length?: KclCommandValue // axis or edge modes only
    ccw: boolean // optional boolean argument, default value to false
  }
  'event.parameter.create': {
    value: KclCommandValue
  }
  'event.parameter.edit': {
    nodeToEdit: PathToNode
    value: KclCommandValue
  }
  'change tool': {
    tool: SketchTool
  }
  'Constrain length': {
    selection: Selections
    length: KclCommandValue
  }
  'Constrain with named value': {
    currentValue: {
      valueText: string
      pathToNode: PathToNode
      variableName: string
    }
    namedValue: KclCommandValue
  }
  'Prompt-to-edit': {
    prompt: string
    selection: Selections
  }
  // TODO: {} means any non-nullish value. This is probably not what we want.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  'Delete selection': {}
  Appearance: {
    nodeToEdit?: PathToNode
    color: string
  }
  Translate: {
    nodeToEdit?: PathToNode
    selection: Selections
    x: KclCommandValue
    y: KclCommandValue
    z: KclCommandValue
  }
  Rotate: {
    nodeToEdit?: PathToNode
    selection: Selections
    roll: KclCommandValue
    pitch: KclCommandValue
    yaw: KclCommandValue
  }
  Clone: {
    nodeToEdit?: PathToNode
    selection: Selections
    variableName: string
  }
  'Boolean Subtract': {
    target: Selections
    tool: Selections
  }
  'Boolean Union': {
    solids: Selections
  }
  'Boolean Intersect': {
    solids: Selections
  }
}

export const modelingMachineCommandConfig: StateMachineCommandSetConfig<
  typeof modelingMachine,
  ModelingCommandSchema
> = {
  'Enter sketch': {
    description: 'Enter sketch mode.',
    icon: 'sketch',
  },
  'change tool': [
    {
      description: 'Start drawing straight lines.',
      icon: 'line',
      displayName: 'Line',
      args: {
        tool: {
          defaultValue: 'line',
          required: true,
          skip: true,
          inputType: 'string',
        },
      },
    },
    {
      description: 'Start drawing an arc tangent to the current segment.',
      icon: 'arc',
      displayName: 'Tangential Arc',
      args: {
        tool: {
          defaultValue: 'tangentialArc',
          required: true,
          skip: true,
          inputType: 'string',
        },
      },
    },
    {
      description: 'Start drawing a rectangle.',
      icon: 'rectangle',
      displayName: 'Rectangle',
      args: {
        tool: {
          defaultValue: 'rectangle',
          required: true,
          skip: true,
          inputType: 'string',
        },
      },
    },
  ],
  Export: {
    description: 'Export the current model.',
    icon: 'floppyDiskArrow',
    needsReview: true,
    args: {
      type: {
        inputType: 'options',
        defaultValue: 'gltf',
        required: true,
        options: [
          { name: 'glTF', isCurrent: true, value: 'gltf' },
          { name: 'OBJ', isCurrent: false, value: 'obj' },
          { name: 'STL', isCurrent: false, value: 'stl' },
          { name: 'STEP', isCurrent: false, value: 'step' },
          { name: 'PLY', isCurrent: false, value: 'ply' },
        ],
      },
      storage: {
        inputType: 'options',
        defaultValue: (c) => {
          switch (c.argumentsToSubmit.type) {
            case 'gltf':
              return 'embedded'
            case 'stl':
              return 'ascii'
            case 'ply':
              return 'ascii'
            default:
              return undefined
          }
        },
        skip: true,
        required: (commandContext) =>
          ['gltf', 'stl', 'ply'].includes(
            commandContext.argumentsToSubmit.type as string
          ),
        options: (commandContext) => {
          const type = commandContext.argumentsToSubmit.type as
            | OutputTypeKey
            | undefined

          switch (type) {
            case 'gltf':
              return [
                { name: 'embedded', isCurrent: true, value: 'embedded' },
                { name: 'binary', isCurrent: false, value: 'binary' },
                { name: 'standard', isCurrent: false, value: 'standard' },
              ]
            case 'stl':
              return [
                { name: 'binary', isCurrent: false, value: 'binary' },
                { name: 'ascii', isCurrent: true, value: 'ascii' },
              ]
            case 'ply':
              return [
                { name: 'ascii', isCurrent: true, value: 'ascii' },
                {
                  name: 'binary_big_endian',
                  isCurrent: false,
                  value: 'binary_big_endian',
                },
                {
                  name: 'binary_little_endian',
                  isCurrent: false,
                  value: 'binary_little_endian',
                },
              ]
            default:
              return []
          }
        },
      },
    },
  },
  Make: {
    hide: 'web',
    displayName: 'Make',
    description:
      'Export the current part and send to a 3D printer on the network.',
    icon: 'printer3d',
    needsReview: true,
    args: {
      machine: {
        inputType: 'options',
        required: true,
        valueSummary: (machine: components['schemas']['MachineInfoResponse']) =>
          machine.make_model.model ||
          machine.make_model.manufacturer ||
          'Unknown Machine',
        options: (commandBarContext) => {
          return Object.values(
            commandBarContext.machineManager?.machines || []
          ).map((machine: components['schemas']['MachineInfoResponse']) => ({
            name:
              `${machine.id} (${
                machine.make_model.model || machine.make_model.manufacturer
              }) (${machine.state.state})` +
              (machine.hardware_configuration &&
              machine.hardware_configuration.type !== 'none' &&
              machine.hardware_configuration.config.nozzle_diameter
                ? ` - Nozzle Diameter: ${machine.hardware_configuration.config.nozzle_diameter}`
                : '') +
              (machine.hardware_configuration &&
              machine.hardware_configuration.type !== 'none' &&
              machine.hardware_configuration.config.filaments &&
              machine.hardware_configuration.config.filaments[0]
                ? ` - ${
                    machine.hardware_configuration.config.filaments[0].name
                  } #${
                    machine.hardware_configuration.config &&
                    machine.hardware_configuration.config.filaments[0].color?.slice(
                      0,
                      6
                    )
                  }`
                : ''),
            isCurrent: false,
            disabled: machine.state.state !== 'idle',
            value: machine,
          }))
        },
        defaultValue: (commandBarContext) => {
          return Object.values(
            commandBarContext.machineManager.machines || []
          )[0]
        },
      },
    },
  },
  Extrude: {
    description: 'Pull a sketch into 3D along its normal or perpendicular.',
    icon: 'extrude',
    needsReview: true,
    args: {
      nodeToEdit: {
        description:
          'Path to the node in the AST to edit. Never shown to the user.',
        skip: true,
        inputType: 'text',
        required: false,
        hidden: true,
      },
      sketches: {
        inputType: 'selection',
        displayName: 'Profiles',
        selectionTypes: ['solid2d'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      length: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: true,
      },
    },
  },
  Sweep: {
    description:
      'Create a 3D body by moving a sketch region along an arbitrary path.',
    icon: 'sweep',
    needsReview: true,
    args: {
      nodeToEdit: {
        description:
          'Path to the node in the AST to edit. Never shown to the user.',
        skip: true,
        inputType: 'text',
        required: false,
        hidden: true,
      },
      sketches: {
        inputType: 'selection',
        displayName: 'Profiles',
        selectionTypes: ['solid2d'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      path: {
        inputType: 'selection',
        selectionTypes: ['segment', 'helix'],
        required: true,
        multiple: false,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      sectional: {
        inputType: 'options',
        skip: true,
        defaultValue: false,
        hidden: false,
        required: true,
        options: [
          { name: 'False', value: false },
          { name: 'True', value: true },
        ],
        // No validation possible here until we have rollback
      },
    },
  },
  Loft: {
    description: 'Create a 3D body by blending between two or more sketches',
    icon: 'loft',
    needsReview: true,
    args: {
      sketches: {
        inputType: 'selection',
        displayName: 'Profiles',
        selectionTypes: ['solid2d'],
        multiple: true,
        required: true,
      },
    },
  },
  Revolve: {
    description: 'Create a 3D body by rotating a sketch region about an axis.',
    icon: 'revolve',
    needsReview: true,
    args: {
      nodeToEdit: {
        description:
          'Path to the node in the AST to edit. Never shown to the user.',
        skip: true,
        inputType: 'text',
        required: false,
      },
      sketches: {
        inputType: 'selection',
        displayName: 'Profiles',
        selectionTypes: ['solid2d'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      axisOrEdge: {
        inputType: 'options',
        required: true,
        defaultValue: 'Axis',
        options: [
          { name: 'Sketch Axis', isCurrent: true, value: 'Axis' },
          { name: 'Edge', isCurrent: false, value: 'Edge' },
        ],
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      axis: {
        required: (commandContext) =>
          ['Axis'].includes(
            commandContext.argumentsToSubmit.axisOrEdge as string
          ),
        inputType: 'options',
        options: [
          { name: 'X Axis (relative to sketch)', isCurrent: true, value: 'X' },
          { name: 'Y Axis (relative to sketch)', isCurrent: false, value: 'Y' },
        ],
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      edge: {
        required: (commandContext) =>
          ['Edge'].includes(
            commandContext.argumentsToSubmit.axisOrEdge as string
          ),
        inputType: 'selection',
        selectionTypes: ['segment', 'sweepEdge', 'edgeCutEdge'],
        multiple: false,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      angle: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_DEGREE,
        required: true,
      },
    },
  },
  Shell: {
    description: 'Hollow out a 3D solid.',
    icon: 'shell',
    needsReview: true,
    args: {
      nodeToEdit: {
        description:
          'Path to the node in the AST to edit. Never shown to the user.',
        skip: true,
        inputType: 'text',
        required: false,
      },
      selection: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      thickness: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: true,
      },
    },
  },
  'Boolean Subtract': {
    description: 'Subtract one solid from another.',
    icon: 'booleanSubtract',
    needsReview: true,
    args: {
      target: {
        inputType: 'selection',
        selectionTypes: ['path'],
        selectionFilter: ['object'],
        multiple: false,
        required: true,
        skip: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      tool: {
        clearSelectionFirst: true,
        inputType: 'selection',
        selectionTypes: ['path'],
        selectionFilter: ['object'],
        multiple: false,
        required: true,
        skip: false,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
    },
  },
  'Boolean Union': {
    description: 'Union multiple solids into a single solid.',
    icon: 'booleanUnion',
    needsReview: true,
    args: {
      solids: {
        inputType: 'selection',
        selectionTypes: ['path'],
        selectionFilter: ['object'],
        multiple: true,
        required: true,
        skip: false,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
    },
  },
  'Boolean Intersect': {
    description: 'Create a solid from the intersection of two solids.',
    icon: 'booleanIntersect',
    needsReview: true,
    args: {
      solids: {
        inputType: 'selectionMixed',
        selectionTypes: ['path'],
        selectionFilter: ['object'],
        multiple: true,
        required: true,
        skip: false,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
    },
  },
  'Offset plane': {
    description: 'Offset a plane.',
    icon: 'plane',
    args: {
      nodeToEdit: {
        description:
          'Path to the node in the AST to edit. Never shown to the user.',
        skip: true,
        inputType: 'text',
        required: false,
        hidden: true,
      },
      plane: {
        inputType: 'selection',
        selectionTypes: ['plane'],
        multiple: false,
        required: true,
        skip: true,
      },
      distance: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: true,
      },
    },
  },
  Helix: {
    description: 'Create a helix or spiral in 3D about an axis.',
    icon: 'helix',
    needsReview: true,
    args: {
      nodeToEdit: {
        description:
          'Path to the node in the AST to edit. Never shown to the user.',
        skip: true,
        inputType: 'text',
        required: false,
        hidden: true,
      },
      mode: {
        inputType: 'options',
        required: true,
        defaultValue: 'Axis',
        options: [
          { name: 'Axis', isCurrent: true, value: 'Axis' },
          { name: 'Edge', isCurrent: false, value: 'Edge' },
          { name: 'Cylinder', isCurrent: false, value: 'Cylinder' },
        ],
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      axis: {
        inputType: 'options',
        required: (commandContext) =>
          ['Axis'].includes(commandContext.argumentsToSubmit.mode as string),
        options: [
          { name: 'X Axis', value: 'X' },
          { name: 'Y Axis', value: 'Y' },
          { name: 'Z Axis', value: 'Z' },
        ],
        hidden: false, // for consistency here, we can actually edit here since it's not a selection
      },
      edge: {
        required: (commandContext) =>
          ['Edge'].includes(commandContext.argumentsToSubmit.mode as string),
        inputType: 'selection',
        selectionTypes: ['segment', 'sweepEdge'],
        multiple: false,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      cylinder: {
        required: (commandContext) =>
          ['Cylinder'].includes(
            commandContext.argumentsToSubmit.mode as string
          ),
        inputType: 'selection',
        selectionTypes: ['wall'],
        multiple: false,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      revolutions: {
        inputType: 'kcl',
        defaultValue: '1',
        required: true,
      },
      angleStart: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_DEGREE,
        required: true,
      },
      radius: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: (commandContext) =>
          !['Cylinder'].includes(
            commandContext.argumentsToSubmit.mode as string
          ),
      },
      length: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: (commandContext) =>
          ['Axis'].includes(commandContext.argumentsToSubmit.mode as string),
      },
      ccw: {
        inputType: 'options',
        skip: true,
        required: true,
        defaultValue: false,
        valueSummary: (value) => String(value),
        displayName: 'CounterClockWise',
        options: (commandContext) => [
          {
            name: 'False',
            value: false,
            isCurrent: !Boolean(commandContext.argumentsToSubmit.ccw),
          },
          {
            name: 'True',
            value: true,
            isCurrent: Boolean(commandContext.argumentsToSubmit.ccw),
          },
        ],
      },
    },
  },
  Fillet: {
    description: 'Fillet edge',
    icon: 'fillet3d',
    needsReview: true,
    args: {
      nodeToEdit: {
        description:
          'Path to the node in the AST to edit. Never shown to the user.',
        inputType: 'text',
        required: false,
        hidden: true,
      },
      selection: {
        inputType: 'selection',
        selectionTypes: ['segment', 'sweepEdge'],
        multiple: true,
        required: true,
        skip: false,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      radius: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: true,
      },
    },
  },
  Chamfer: {
    description: 'Chamfer edge',
    icon: 'chamfer3d',
    needsReview: true,
    args: {
      nodeToEdit: {
        description:
          'Path to the node in the AST to edit. Never shown to the user.',
        inputType: 'text',
        required: false,
        hidden: true,
      },
      selection: {
        inputType: 'selection',
        selectionTypes: ['segment', 'sweepEdge'],
        multiple: true,
        required: true,
        skip: false,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      length: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: true,
      },
    },
  },
  'event.parameter.create': {
    displayName: 'Create parameter',
    description: 'Add a named constant to use in geometry',
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
  },
  'event.parameter.edit': {
    displayName: 'Edit parameter',
    description: 'Edit the value of a named constant',
    icon: 'make-variable',
    needsReview: false,
    args: {
      nodeToEdit: {
        displayName: 'Name',
        inputType: 'options',
        valueSummary: (nodeToEdit: PathToNode) => {
          const node = getNodeFromPath<VariableDeclarator>(
            kclManager.ast,
            nodeToEdit
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
                const range: SourceRange = [node.start, node.end, node.moduleId]
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
  },
  'Constrain length': {
    description: 'Constrain the length of one or more segments.',
    icon: 'dimension',
    args: {
      selection: {
        inputType: 'selection',
        selectionTypes: ['segment'],
        multiple: false,
        required: true,
        skip: true,
      },
      length: {
        inputType: 'kcl',
        required: true,
        createVariable: 'byDefault',
        defaultValue(_, machineContext) {
          const selectionRanges = machineContext?.selectionRanges
          if (!selectionRanges) return KCL_DEFAULT_LENGTH
          const angleLength = angleLengthInfo({
            selectionRanges,
            angleOrLength: 'setLength',
          })
          if (err(angleLength)) return KCL_DEFAULT_LENGTH
          const { transforms } = angleLength

          // QUESTION: is it okay to reference kclManager here? will its state be up to date?
          const sketched = transformAstSketchLines({
            ast: structuredClone(kclManager.ast),
            selectionRanges,
            transformInfos: transforms,
            memVars: kclManager.variables,
            referenceSegName: '',
          })
          if (err(sketched)) return KCL_DEFAULT_LENGTH
          const { valueUsedInTransform } = sketched
          return valueUsedInTransform?.toString() || KCL_DEFAULT_LENGTH
        },
      },
    },
  },
  'Constrain with named value': {
    description: 'Constrain a value by making it a named constant.',
    icon: 'make-variable',
    args: {
      currentValue: {
        description:
          'Path to the node in the AST to constrain. This is never shown to the user.',
        inputType: 'text',
        required: false,
        skip: true,
      },
      namedValue: {
        inputType: 'kcl',
        required: true,
        createVariable: 'byDefault',
        variableName(commandBarContext, _machineContext) {
          const { currentValue } = commandBarContext.argumentsToSubmit
          if (
            !currentValue ||
            !(currentValue instanceof Object) ||
            !('variableName' in currentValue) ||
            typeof currentValue.variableName !== 'string'
          ) {
            return 'value'
          }
          return currentValue.variableName
        },
        defaultValue: (commandBarContext) => {
          const { currentValue } = commandBarContext.argumentsToSubmit
          if (
            !currentValue ||
            !(currentValue instanceof Object) ||
            !('valueText' in currentValue) ||
            typeof currentValue.valueText !== 'string'
          ) {
            return KCL_DEFAULT_LENGTH
          }
          return currentValue.valueText
        },
      },
    },
  },
  'Prompt-to-edit': {
    displayName: 'Text-to-CAD Edit',
    description:
      'Use machine learning to edit your parts and code from a text prompt.',
    icon: 'sparkles',
    status: IS_ML_EXPERIMENTAL ? 'experimental' : 'active',
    args: {
      selection: {
        inputType: 'selectionMixed',
        selectionTypes: [
          'solid2d',
          'segment',
          'sweepEdge',
          'cap',
          'wall',
          'edgeCut',
          'edgeCutEdge',
        ],
        multiple: true,
        required: false,
        selectionSource: {
          allowSceneSelection: true,
          allowCodeSelection: true,
        },
        skip: false,
      },
      prompt: {
        inputType: 'text',
        required: true,
      },
    },
  },
  Appearance: {
    description:
      'Set the appearance of a solid. This only works on solids, not sketches or individual paths.',
    icon: 'extrude',
    needsReview: true,
    args: {
      nodeToEdit: {
        description:
          'Path to the node in the AST to edit. Never shown to the user.',
        skip: true,
        inputType: 'text',
        required: false,
        hidden: true,
      },
      color: {
        inputType: 'options',
        required: true,
        options: [
          { name: 'Red', value: '#FF0000' },
          { name: 'Green', value: '#00FF00' },
          { name: 'Blue', value: '#0000FF' },
          { name: 'Turquoise', value: '#00FFFF' },
          { name: 'Purple', value: '#FF00FF' },
          { name: 'Yellow', value: '#FFFF00' },
          { name: 'Black', value: '#000000' },
          { name: 'Dark Grey', value: '#080808' },
          { name: 'Light Grey', value: '#D3D3D3' },
          { name: 'White', value: '#FFFFFF' },
          {
            name: 'Default (clear appearance)',
            value: COMMAND_APPEARANCE_COLOR_DEFAULT,
          },
        ],
      },
      // Add more fields
    },
  },
  Translate: {
    description: 'Set translation on solid or sketch.',
    icon: 'move',
    needsReview: true,
    args: {
      nodeToEdit: {
        description:
          'Path to the node in the AST to edit. Never shown to the user.',
        skip: true,
        inputType: 'text',
        required: false,
        hidden: true,
      },
      selection: {
        // selectionMixed allows for feature tree selection of module imports
        inputType: 'selectionMixed',
        multiple: false,
        required: true,
        skip: true,
        selectionTypes: ['path'],
        selectionFilter: ['object'],
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      x: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_TRANSFORM,
        required: true,
      },
      y: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_TRANSFORM,
        required: true,
      },
      z: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_TRANSFORM,
        required: true,
      },
    },
  },
  Rotate: {
    description: 'Set rotation on solid or sketch.',
    icon: 'rotate',
    needsReview: true,
    args: {
      nodeToEdit: {
        description:
          'Path to the node in the AST to edit. Never shown to the user.',
        skip: true,
        inputType: 'text',
        required: false,
        hidden: true,
      },
      selection: {
        // selectionMixed allows for feature tree selection of module imports
        inputType: 'selectionMixed',
        multiple: false,
        required: true,
        skip: true,
        selectionTypes: ['path'],
        selectionFilter: ['object'],
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      roll: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_TRANSFORM,
        required: true,
      },
      pitch: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_TRANSFORM,
        required: true,
      },
      yaw: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_TRANSFORM,
        required: true,
      },
    },
  },
  Clone: {
    description: 'Clone a solid or sketch.',
    icon: 'clone',
    needsReview: true,
    args: {
      nodeToEdit: {
        description:
          'Path to the node in the AST to edit. Never shown to the user.',
        skip: true,
        inputType: 'text',
        required: false,
        hidden: true,
      },
      selection: {
        // selectionMixed allows for feature tree selection of module imports
        inputType: 'selectionMixed',
        multiple: false,
        required: true,
        skip: true,
        selectionTypes: ['path'],
        selectionFilter: ['object'],
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      variableName: {
        inputType: 'string',
        required: true,
        defaultValue: () => {
          return findUniqueName(
            kclManager.ast,
            KCL_DEFAULT_CONSTANT_PREFIXES.CLONE
          )
        },
        validation: async ({ data }: { data: string }) => {
          const variableExists = kclManager.variables[data]
          if (variableExists) {
            return 'This variable name is already in use.'
          }

          return true
        },
      },
    },
  },
}

modelingMachineCommandConfig
