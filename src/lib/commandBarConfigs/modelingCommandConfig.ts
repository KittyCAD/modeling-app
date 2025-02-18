import { Models } from '@kittycad/lib'
import { angleLengthInfo } from 'components/Toolbar/setAngleLength'
import { transformAstSketchLines } from 'lang/std/sketchcombos'
import { PathToNode } from 'lang/wasm'
import { StateMachineCommandSetConfig, KclCommandValue } from 'lib/commandTypes'
import { KCL_DEFAULT_LENGTH, KCL_DEFAULT_DEGREE } from 'lib/constants'
import { components } from 'lib/machine-api'
import { Selections } from 'lib/selections'
import { kclManager } from 'lib/singletons'
import { err } from 'lib/trap'
import { modelingMachine, SketchTool } from 'machines/modelingMachine'
import {
  loftValidator,
  revolveAxisValidator,
  shellValidator,
  sweepValidator,
} from './validators'

type OutputFormat = Models['OutputFormat_type']
type OutputTypeKey = OutputFormat['type']
type ExtractStorageTypes<T> = T extends { storage: infer U } ? U : never
type StorageUnion = ExtractStorageTypes<OutputFormat>

export const EXTRUSION_RESULTS = [
  'new',
  'add',
  'subtract',
  'intersect',
] as const

export type ModelingCommandSchema = {
  'Enter sketch': {}
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
    selection: Selections // & { type: 'face' } would be cool to lock that down
    // result: (typeof EXTRUSION_RESULTS)[number]
    distance: KclCommandValue
  }
  Sweep: {
    target: Selections
    trajectory: Selections
  }
  Loft: {
    selection: Selections
  }
  Shell: {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // KCL stdlib arguments
    selection: Selections
    thickness: KclCommandValue
  }
  Revolve: {
    selection: Selections
    angle: KclCommandValue
    axisOrEdge: 'Axis' | 'Edge'
    axis: string
    edge: Selections
  }
  Fillet: {
    selection: Selections
    radius: KclCommandValue
  }
  Chamfer: {
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
    revolutions: KclCommandValue
    angleStart: KclCommandValue
    counterClockWise: boolean
    radius: KclCommandValue
    axis: string
    length: KclCommandValue
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
  'Text-to-CAD': {
    prompt: string
  }
  'Prompt-to-edit': {
    prompt: string
    selection: Selections
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
          )[0] as components['schemas']['MachineInfoResponse']
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
      },
      selection: {
        inputType: 'selection',
        selectionTypes: ['solid2d', 'segment'],
        multiple: false, // TODO: multiple selection
        required: true,
        skip: true,
      },
      // result: {
      //   inputType: 'options',
      //   defaultValue: 'add',
      //   skip: true,
      //   required: true,
      //   options: EXTRUSION_RESULTS.map((r) => ({
      //     name: r,
      //     isCurrent: r === 'add',
      //     value: r,
      //   })),
      // },
      distance: {
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
    needsReview: false,
    args: {
      target: {
        inputType: 'selection',
        selectionTypes: ['solid2d'],
        required: true,
        skip: true,
        multiple: false,
      },
      trajectory: {
        inputType: 'selection',
        selectionTypes: ['segment', 'path'],
        required: true,
        skip: false,
        multiple: false,
        validation: sweepValidator,
      },
    },
  },
  Loft: {
    description: 'Create a 3D body by blending between two or more sketches',
    icon: 'loft',
    needsReview: false,
    args: {
      selection: {
        inputType: 'selection',
        selectionTypes: ['solid2d'],
        multiple: true,
        required: true,
        skip: false,
        validation: loftValidator,
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
        validation: shellValidator,
        skip: true,
      },
      thickness: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: true,
        // TODO: add dry-run validation on thickness param
      },
    },
  },
  Revolve: {
    description: 'Create a 3D body by rotating a sketch region about an axis.',
    icon: 'revolve',
    needsReview: true,
    args: {
      selection: {
        inputType: 'selection',
        selectionTypes: ['solid2d', 'segment'],
        multiple: false, // TODO: multiple selection
        required: true,
        skip: true,
      },
      axisOrEdge: {
        inputType: 'options',
        required: true,
        defaultValue: 'Axis',
        options: [
          { name: 'Axis', isCurrent: true, value: 'Axis' },
          { name: 'Edge', isCurrent: false, value: 'Edge' },
        ],
      },
      axis: {
        required: (commandContext) =>
          ['Axis'].includes(
            commandContext.argumentsToSubmit.axisOrEdge as string
          ),
        inputType: 'options',
        options: [
          { name: 'X Axis', isCurrent: true, value: 'X' },
          { name: 'Y Axis', isCurrent: false, value: 'Y' },
        ],
      },
      edge: {
        required: (commandContext) =>
          ['Edge'].includes(
            commandContext.argumentsToSubmit.axisOrEdge as string
          ),
        inputType: 'selection',
        selectionTypes: ['segment', 'sweepEdge', 'edgeCutEdge'],
        multiple: false,
        validation: revolveAxisValidator,
      },
      angle: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_DEGREE,
        required: true,
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
    status: 'development',
    needsReview: true,
    args: {
      revolutions: {
        inputType: 'kcl',
        defaultValue: '1',
        required: true,
        warningMessage:
          'The helix workflow is new and under tested. Please break it and report issues.',
      },
      angleStart: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_DEGREE,
        required: true,
      },
      counterClockWise: {
        inputType: 'options',
        required: true,
        options: [
          { name: 'True', isCurrent: false, value: true },
          { name: 'False', isCurrent: true, value: false },
        ],
      },
      radius: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: true,
      },
      axis: {
        inputType: 'options',
        required: true,
        options: [
          { name: 'X Axis', isCurrent: true, value: 'X' },
          { name: 'Y Axis', isCurrent: false, value: 'Y' },
          { name: 'Z Axis', isCurrent: false, value: 'Z' },
        ],
      },
      length: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: true,
      },
    },
  },
  Fillet: {
    description: 'Fillet edge',
    icon: 'fillet3d',
    status: 'development',
    needsReview: true,
    args: {
      selection: {
        inputType: 'selection',
        selectionTypes: ['segment', 'sweepEdge', 'edgeCutEdge'],
        multiple: true,
        required: true,
        skip: false,
        warningMessage:
          'Fillets cannot touch other fillets yet. This is under development.',
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
    status: 'development',
    needsReview: true,
    args: {
      selection: {
        inputType: 'selection',
        selectionTypes: ['segment', 'sweepEdge', 'edgeCutEdge'],
        multiple: true,
        required: true,
        skip: false,
        warningMessage:
          'Chamfers cannot touch other chamfers yet. This is under development.',
      },
      length: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: true,
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
        createVariableByDefault: true,
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
        createVariableByDefault: true,
        variableName(commandBarContext, machineContext) {
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
  'Text-to-CAD': {
    description: 'Use the Zoo Text-to-CAD API to generate part starters.',
    icon: 'chat',
    args: {
      prompt: {
        inputType: 'text',
        required: true,
      },
    },
  },
  'Prompt-to-edit': {
    description: 'Use Zoo AI to edit your kcl',
    icon: 'chat',
    args: {
      selection: {
        inputType: 'selection',
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
        required: true,
        skip: true,
      },
      prompt: {
        inputType: 'text',
        required: true,
      },
    },
  },
}
