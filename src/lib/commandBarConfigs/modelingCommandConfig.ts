import type { EntityType, OutputFormat3d } from '@kittycad/lib'

import { angleLengthInfo } from '@src/components/Toolbar/angleLengthInfo'
import { findUniqueName } from '@src/lang/create'
import { transformAstSketchLines } from '@src/lang/std/sketchcombos'
import type { Artifact, PathToNode } from '@src/lang/wasm'
import type {
  CommandArgumentConfig,
  KclCommandValue,
  StateMachineCommandSetConfig,
} from '@src/lib/commandTypes'
import {
  KCL_DEFAULT_CONSTANT_PREFIXES,
  KCL_DEFAULT_DEGREE,
  KCL_DEFAULT_INSTANCES,
  KCL_DEFAULT_LENGTH,
  KCL_DEFAULT_TRANSFORM,
  KCL_DEFAULT_ORIGIN,
  KCL_DEFAULT_ORIGIN_2D,
  KCL_AXIS_X,
  KCL_AXIS_Y,
  KCL_AXIS_Z,
  KCL_PLANE_XY,
  KCL_PLANE_XZ,
  KCL_PLANE_YZ,
  KCL_DEFAULT_TOLERANCE,
  KCL_DEFAULT_PRECISION,
  KCL_DEFAULT_FONT_POINT_SIZE,
  KCL_DEFAULT_FONT_SCALE,
  type KclPreludeBodyType,
  KCL_PRELUDE_BODY_TYPE_VALUES,
  KCL_PRELUDE_EXTRUDE_METHOD_VALUES,
  type KclPreludeExtrudeMethod,
} from '@src/lib/constants'
import type { components } from '@src/lib/machine-api'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { err } from '@src/lib/trap'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type {
  ModelingMachineContext,
  SketchTool,
} from '@src/machines/modelingSharedTypes'

import type { HoleBody, HoleBottom, HoleType } from '@src/lang/modifyAst/faces'
import {
  addExtrude,
  addLoft,
  addRevolve,
  addSweep,
  type SweepRelativeTo,
} from '@src/lang/modifyAst/sweeps'
import { mockExecAstAndReportErrors } from '@src/lang/modelingWorkflows'
import { addHole, addOffsetPlane, addShell } from '@src/lang/modifyAst/faces'
import {
  addIntersect,
  addSubtract,
  addUnion,
} from '@src/lang/modifyAst/boolean'
import { addHelix } from '@src/lang/modifyAst/geometry'
import {
  addAppearance,
  addClone,
  addRotate,
  addScale,
  addTranslate,
} from '@src/lang/modifyAst/transforms'
import {
  addPatternCircular3D,
  addPatternLinear3D,
} from '@src/lang/modifyAst/pattern3D'
import { addChamfer, addFillet } from '@src/lang/modifyAst/edges'
import {
  addFlatnessGdt,
  addDatumGdt,
  getNextAvailableDatumName,
} from '@src/lang/modifyAst/gdt'
import { capitaliseFC } from '@src/lib/utils'
import type { ConnectionManager } from '@src/network/connectionManager'

type OutputFormat = OutputFormat3d
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

// For all nodeToEdit-like arguments needed for edit flows
const nodeToEditDescription =
  'Path to the node in the AST to edit. Never shown to the user.'
const nodeToEditProps = {
  description: nodeToEditDescription,
  inputType: 'text',
  required: false,
  hidden: true,
} as CommandArgumentConfig<PathToNode | undefined, ModelingMachineContext>

// For all transforms and boolean commands
const objectsTypesAndFilters: {
  selectionTypes: Artifact['type'][]
  selectionFilter: EntityType[]
} = {
  selectionTypes: ['path', 'sweep', 'compositeSolid'],
  selectionFilter: ['object'],
}

// For all surface modeling commands
const kclBodyTypeOptions = KCL_PRELUDE_BODY_TYPE_VALUES.map((value) => ({
  name: capitaliseFC(value.toLowerCase()),
  value,
}))

const hasEngineConnection = (
  engineCommandManager: ConnectionManager
): true | Error => {
  return (
    engineCommandManager.connection?.connected ||
    new Error('No engine connection to send command')
  )
}

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
    length?: KclCommandValue
    to?: Selections
    symmetric?: boolean
    bidirectionalLength?: KclCommandValue
    tagStart?: string
    tagEnd?: string
    twistAngle?: KclCommandValue
    twistAngleStep?: KclCommandValue
    twistCenter?: KclCommandValue
    // TODO: figure out if we should expose `tolerance` or not
    // @pierremtb: I don't even think it should be in KCL
    method?: KclPreludeExtrudeMethod
    bodyType?: KclPreludeBodyType
  }
  Sweep: {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // KCL stdlib arguments
    sketches: Selections
    path: Selections
    sectional?: boolean
    // TODO: figure out if we should expose `tolerance` or not
    relativeTo?: SweepRelativeTo
    tagStart?: string
    tagEnd?: string
  }
  Loft: {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // KCL stdlib arguments
    sketches: Selections
    vDegree?: KclCommandValue
    bezApproximateRational?: boolean
    baseCurveIndex?: KclCommandValue
    // TODO: figure out if we should expose `tolerance` or not
    tagStart?: string
    tagEnd?: string
    bodyType?: KclPreludeBodyType
  }
  Revolve: {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // Flow arg
    axisOrEdge: 'Axis' | 'Edge'
    // KCL stdlib arguments
    sketches: Selections
    axis: string | undefined
    edge: Selections | undefined
    angle: KclCommandValue
    // TODO: figure out if we should expose `tolerance` or not
    tagStart?: string
    tagEnd?: string
    symmetric?: boolean
    bidirectionalAngle?: KclCommandValue
    bodyType?: KclPreludeBodyType
  }
  Shell: {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // KCL stdlib arguments, note that we'll be inferring solids from faces here
    faces: Selections
    thickness: KclCommandValue
  }
  Hole: {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // KCL stdlib arguments, note that we'll be inferring solids from faces here
    face: Selections
    cutAt: KclCommandValue
    holeBody: HoleBody
    blindDepth?: KclCommandValue
    blindDiameter?: KclCommandValue
    holeType: HoleType
    counterboreDepth?: KclCommandValue
    counterboreDiameter?: KclCommandValue
    countersinkAngle?: KclCommandValue
    countersinkDiameter?: KclCommandValue
    holeBottom: HoleBottom
    drillPointAngle?: KclCommandValue
  }
  Fillet: {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // KCL stdlib arguments
    selection: Selections // this is named 'tags' in the stdlib
    radius: KclCommandValue
    tag?: string
  }
  Chamfer: {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // KCL stdlib arguments
    selection: Selections // this is named 'tags' in the stdlib
    length: KclCommandValue
    secondLength?: KclCommandValue
    angle?: KclCommandValue
    tag?: string
  }
  'Offset plane': {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    plane: Selections
    offset: KclCommandValue
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
    ccw?: boolean // optional boolean argument, default value to false
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
    objects: Selections
    color: string
    metalness?: KclCommandValue
    roughness?: KclCommandValue
  }
  Translate: {
    nodeToEdit?: PathToNode
    objects: Selections
    x?: KclCommandValue
    y?: KclCommandValue
    z?: KclCommandValue
    global?: boolean
  }
  Rotate: {
    nodeToEdit?: PathToNode
    objects: Selections
    roll?: KclCommandValue
    pitch?: KclCommandValue
    yaw?: KclCommandValue
    global?: boolean
  }
  Scale: {
    nodeToEdit?: PathToNode
    objects: Selections
    x?: KclCommandValue
    y?: KclCommandValue
    z?: KclCommandValue
    factor?: KclCommandValue
    global?: boolean
  }
  Clone: {
    nodeToEdit?: PathToNode
    objects: Selections
    variableName: string
  }
  'Pattern Circular 3D': {
    nodeToEdit?: PathToNode
    solids: Selections
    instances: KclCommandValue
    axis: string
    center: KclCommandValue
    arcDegrees?: KclCommandValue
    rotateDuplicates?: boolean
    useOriginal?: boolean
  }
  'Pattern Linear 3D': {
    nodeToEdit?: PathToNode
    solids: Selections
    instances: KclCommandValue
    distance: KclCommandValue
    axis: string
    useOriginal?: boolean
  }
  'GDT Flatness': {
    nodeToEdit?: PathToNode
    faces: Selections
    tolerance: KclCommandValue
    precision?: KclCommandValue
    framePosition?: KclCommandValue
    framePlane?: string
    fontPointSize?: KclCommandValue
    fontScale?: KclCommandValue
  }
  'GDT Datum': {
    nodeToEdit?: PathToNode
    faces: Selections
    name: string
    framePosition?: KclCommandValue
    framePlane?: string
    fontPointSize?: KclCommandValue
    fontScale?: KclCommandValue
  }
  'Boolean Subtract': {
    solids: Selections
    tools: Selections
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
        hidden: (commandContext) =>
          !['gltf', 'stl', 'ply'].includes(
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
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addExtrude({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Extrude']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await context.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      sketches: {
        inputType: 'selection',
        displayName: 'Profiles',
        selectionTypes: ['solid2d', 'segment'],
        multiple: true,
        required: true,
      },
      length: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: false,
        prepopulate: true,
      },
      to: {
        inputType: 'selection',
        // TODO: add edgeCut during https://github.com/KittyCAD/modeling-app/issues/8831
        selectionTypes: ['cap', 'wall'],
        clearSelectionFirst: true,
        required: false,
        multiple: false,
        description: 'Note: Only parallel faces are supported for now.',
      },
      symmetric: {
        inputType: 'boolean',
        required: false,
      },
      bidirectionalLength: {
        inputType: 'kcl',
        required: false,
      },
      tagStart: {
        inputType: 'tagDeclarator',
        required: false,
        // TODO: add validation like for Clone command
      },
      tagEnd: {
        inputType: 'tagDeclarator',
        required: false,
      },
      twistAngle: {
        inputType: 'kcl',
        required: false,
      },
      twistAngleStep: {
        inputType: 'kcl',
        required: false,
      },
      twistCenter: {
        inputType: 'vector2d',
        required: false,
        defaultValue: KCL_DEFAULT_ORIGIN_2D,
      },
      method: {
        inputType: 'options',
        required: false,
        options: KCL_PRELUDE_EXTRUDE_METHOD_VALUES.map((value) => ({
          name: capitaliseFC(value.toLowerCase()),
          value,
        })),
      },
      bodyType: {
        inputType: 'options',
        required: false,
        options: kclBodyTypeOptions,
      },
    },
  },
  Sweep: {
    description:
      'Create a 3D body by moving a sketch region along an arbitrary path.',
    icon: 'sweep',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addSweep({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Sweep']),
        ast: kclManager.ast,
        wasmInstance: await context.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      sketches: {
        inputType: 'selection',
        displayName: 'Profiles',
        selectionTypes: ['solid2d'],
        multiple: true,
        required: true,
      },
      path: {
        inputType: 'selection',
        selectionTypes: ['path', 'helix'],
        selectionFilter: ['object'],
        required: true,
        multiple: false,
      },
      sectional: {
        inputType: 'boolean',
        required: false,
      },
      relativeTo: {
        inputType: 'options',
        required: false,
        options: [
          { name: 'Sketch Plane', value: 'SKETCH_PLANE' },
          { name: 'Trajectory Curve', value: 'TRAJECTORY' },
        ],
      },
      tagStart: {
        inputType: 'tagDeclarator',
        required: false,
      },
      tagEnd: {
        inputType: 'tagDeclarator',
        required: false,
      },
    },
  },
  Loft: {
    description: 'Create a 3D body by blending between two or more sketches',
    icon: 'loft',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addLoft({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Loft']),
        ast: kclManager.ast,
        wasmInstance: await context.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      sketches: {
        inputType: 'selection',
        displayName: 'Profiles',
        selectionTypes: ['solid2d'],
        multiple: true,
        required: true,
        description: `
          Note: Only closed paths are allowed for now. Selection of open paths via segments for surface modeling is coming soon.
        `.trim(),
      },
      vDegree: {
        inputType: 'kcl',
        required: false,
      },
      bezApproximateRational: {
        inputType: 'boolean',
        required: false,
      },
      baseCurveIndex: {
        inputType: 'kcl',
        required: false,
      },
      tagStart: {
        inputType: 'tagDeclarator',
        required: false,
      },
      tagEnd: {
        inputType: 'tagDeclarator',
        required: false,
      },
      bodyType: {
        inputType: 'options',
        required: false,
        options: kclBodyTypeOptions,
      },
    },
  },
  Revolve: {
    description: 'Create a 3D body by rotating a sketch region about an axis.',
    icon: 'revolve',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addRevolve({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Revolve']),
        ast: kclManager.ast,
        wasmInstance: await context.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      sketches: {
        inputType: 'selection',
        displayName: 'Profiles',
        selectionTypes: ['solid2d', 'segment'],
        multiple: true,
        required: true,
      },
      axisOrEdge: {
        inputType: 'options',
        required: true,
        defaultValue: 'Axis',
        options: [
          { name: 'Sketch Axis', isCurrent: true, value: 'Axis' },
          { name: 'Edge', isCurrent: false, value: 'Edge' },
        ],
      },
      axis: {
        required: (context) =>
          ['Axis'].includes(context.argumentsToSubmit.axisOrEdge as string),
        inputType: 'options',
        displayName: 'Sketch Axis',
        options: [
          { name: 'X Axis', isCurrent: true, value: 'X' },
          { name: 'Y Axis', isCurrent: false, value: 'Y' },
        ],
        hidden: (context) =>
          Boolean(context.argumentsToSubmit.nodeToEdit) ||
          !['Axis'].includes(context.argumentsToSubmit.axisOrEdge as string),
      },
      edge: {
        required: (context) =>
          ['Edge'].includes(context.argumentsToSubmit.axisOrEdge as string),
        inputType: 'selection',
        selectionTypes: ['segment', 'sweepEdge', 'edgeCutEdge'],
        multiple: false,
        hidden: (context) =>
          Boolean(context.argumentsToSubmit.nodeToEdit) ||
          !['Edge'].includes(context.argumentsToSubmit.axisOrEdge as string),
      },
      angle: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_DEGREE,
        required: true,
      },
      symmetric: {
        inputType: 'boolean',
        required: false,
      },
      bidirectionalAngle: {
        inputType: 'kcl',
        required: false,
      },
      tagStart: {
        inputType: 'tagDeclarator',
        required: false,
      },
      tagEnd: {
        inputType: 'tagDeclarator',
        required: false,
      },
      bodyType: {
        inputType: 'options',
        required: false,
        options: kclBodyTypeOptions,
      },
    },
  },
  Shell: {
    description: 'Hollow out a 3D solid.',
    icon: 'shell',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addShell({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Shell']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await context.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      faces: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall'],
        multiple: true,
        required: true,
      },
      thickness: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: true,
      },
    },
  },
  Hole: {
    description: 'Standard holes that could be drilled or cut into a 3D solid.',
    icon: 'hole',
    needsReview: true,
    reviewMessage:
      'The argument cutAt specifies where to place the hole given as absolute coordinates in the global scene. Point selection will be allowed in the future, and more hole bottoms and hole types are coming soon.',
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addHole({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Hole']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await context.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      face: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall', 'edgeCut'],
        multiple: false,
        required: true,
      },
      cutAt: {
        inputType: 'vector2d',
        required: true,
        defaultValue: KCL_DEFAULT_ORIGIN_2D,
      },
      holeBody: {
        inputType: 'options',
        required: true,
        options: [{ name: 'Blind', isCurrent: true, value: 'blind' }],
      },
      blindDepth: {
        inputType: 'kcl',
        required: (context) =>
          ['blind'].includes(context.argumentsToSubmit.holeBody as string),
        hidden: (context) =>
          !['blind'].includes(context.argumentsToSubmit.holeBody as string),
        defaultValue: '2',
      },
      blindDiameter: {
        inputType: 'kcl',
        required: (context) =>
          ['blind'].includes(context.argumentsToSubmit.holeBody as string),
        hidden: (context) =>
          !['blind'].includes(context.argumentsToSubmit.holeBody as string),
        defaultValue: '1',
      },
      holeType: {
        inputType: 'options',
        required: true,
        options: [
          { name: 'Simple', isCurrent: true, value: 'simple' },
          { name: 'Counterbore', isCurrent: true, value: 'counterbore' },
          { name: 'Countersink', isCurrent: true, value: 'countersink' },
        ],
      },
      counterboreDepth: {
        inputType: 'kcl',
        required: (context) =>
          ['counterbore'].includes(
            context.argumentsToSubmit.holeType as string
          ),
        hidden: (context) =>
          !['counterbore'].includes(
            context.argumentsToSubmit.holeType as string
          ),
        defaultValue: '1',
      },
      counterboreDiameter: {
        inputType: 'kcl',
        required: (context) =>
          ['counterbore'].includes(
            context.argumentsToSubmit.holeType as string
          ),
        hidden: (context) =>
          !['counterbore'].includes(
            context.argumentsToSubmit.holeType as string
          ),
        defaultValue: '2',
      },
      countersinkAngle: {
        inputType: 'kcl',
        required: (context) =>
          ['countersink'].includes(
            context.argumentsToSubmit.holeType as string
          ),
        hidden: (context) =>
          !['countersink'].includes(
            context.argumentsToSubmit.holeType as string
          ),
        defaultValue: '90deg',
      },
      countersinkDiameter: {
        inputType: 'kcl',
        required: (context) =>
          ['countersink'].includes(
            context.argumentsToSubmit.holeType as string
          ),
        hidden: (context) =>
          !['countersink'].includes(
            context.argumentsToSubmit.holeType as string
          ),
        defaultValue: '2',
      },
      holeBottom: {
        inputType: 'options',
        required: true,
        options: [
          { name: 'Flat', isCurrent: true, value: 'flat' },
          { name: 'Drill', isCurrent: false, value: 'drill' },
        ],
      },
      drillPointAngle: {
        inputType: 'kcl',
        required: (context) =>
          ['drill'].includes(context.argumentsToSubmit.holeBottom as string),
        hidden: (context) =>
          !['drill'].includes(context.argumentsToSubmit.holeBottom as string),
        defaultValue: '110deg',
      },
    },
  },
  'Boolean Subtract': {
    description: 'Subtract one solid from another.',
    icon: 'booleanSubtract',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addSubtract({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Boolean Subtract']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await kclManager.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      solids: {
        ...objectsTypesAndFilters,
        inputType: 'selectionMixed',
        multiple: true,
        required: true,
      },
      tools: {
        ...objectsTypesAndFilters,
        inputType: 'selection',
        clearSelectionFirst: true,
        multiple: true,
        required: true,
      },
    },
  },
  'Boolean Union': {
    description: 'Union multiple solids into a single solid.',
    icon: 'booleanUnion',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addUnion({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Boolean Union']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await kclManager.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      solids: {
        ...objectsTypesAndFilters,
        inputType: 'selectionMixed',
        multiple: true,
        required: true,
        skip: false,
      },
    },
  },
  'Boolean Intersect': {
    description: 'Create a solid from the intersection of two solids.',
    icon: 'booleanIntersect',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addIntersect({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Boolean Intersect']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await kclManager.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      solids: {
        ...objectsTypesAndFilters,
        inputType: 'selectionMixed',
        multiple: true,
        required: true,
        skip: false,
      },
    },
  },
  'Offset plane': {
    description: 'Offset a plane.',
    icon: 'plane',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addOffsetPlane({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Offset plane']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        variables: kclManager.variables,
        wasmInstance: await context.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      plane: {
        inputType: 'selection',
        selectionTypes: ['plane', 'cap', 'wall', 'edgeCut'],
        multiple: false,
        required: true,
        skip: true,
      },
      offset: {
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
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addHelix({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Helix']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await context.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
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
      },
      axis: {
        inputType: 'options',
        options: [
          { name: 'X Axis', value: 'X' },
          { name: 'Y Axis', value: 'Y' },
          { name: 'Z Axis', value: 'Z' },
        ],
        required: (context) =>
          ['Axis'].includes(context.argumentsToSubmit.mode as string),
        hidden: (context) =>
          !['Axis'].includes(context.argumentsToSubmit.mode as string),
      },
      edge: {
        inputType: 'selection',
        selectionTypes: ['segment', 'sweepEdge'],
        multiple: false,
        required: (context) =>
          ['Edge'].includes(context.argumentsToSubmit.mode as string),
        hidden: (context) =>
          Boolean(context.argumentsToSubmit.nodeToEdit) ||
          !['Edge'].includes(context.argumentsToSubmit.mode as string),
      },
      cylinder: {
        ...objectsTypesAndFilters,
        inputType: 'selection',
        multiple: false,
        required: (context) =>
          ['Cylinder'].includes(context.argumentsToSubmit.mode as string),
        hidden: (context) =>
          Boolean(context.argumentsToSubmit.nodeToEdit) ||
          !['Cylinder'].includes(context.argumentsToSubmit.mode as string),
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
        required: (context) =>
          !['Cylinder'].includes(context.argumentsToSubmit.mode as string),
        hidden: (context) =>
          ['Cylinder'].includes(context.argumentsToSubmit.mode as string),
      },
      length: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: (commandContext) =>
          ['Axis'].includes(commandContext.argumentsToSubmit.mode as string),
        // No need for hidden here, as it works with all modes
      },
      ccw: {
        displayName: 'CounterClockWise',
        inputType: 'boolean',
        required: false,
      },
    },
  },
  Fillet: {
    description: 'Fillet edge',
    icon: 'fillet3d',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addFillet({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Fillet']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await kclManager.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      selection: {
        inputType: 'selection',
        selectionTypes: ['segment', 'sweepEdge'],
        multiple: true,
        required: true,
        skip: false,
      },
      radius: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: true,
      },
      tag: {
        inputType: 'tagDeclarator',
        required: false,
        // TODO: add validation like for Clone command
      },
    },
  },
  Chamfer: {
    description: 'Chamfer edge',
    icon: 'chamfer3d',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addChamfer({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Chamfer']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await kclManager.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      selection: {
        inputType: 'selection',
        selectionTypes: ['segment', 'sweepEdge'],
        multiple: true,
        required: true,
        skip: false,
      },
      length: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: true,
      },
      secondLength: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LENGTH,
        required: false,
      },
      angle: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_DEGREE,
        required: false,
      },
      tag: {
        inputType: 'tagDeclarator',
        required: false,
        // TODO: add validation like for Clone command
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
        defaultValue(_, machineContext, wasmInstance) {
          const selectionRanges = machineContext?.selectionRanges
          if (!selectionRanges || !wasmInstance) return KCL_DEFAULT_LENGTH
          const angleLength = angleLengthInfo({
            selectionRanges,
            angleOrLength: 'setLength',
            kclManager: machineContext.kclManager,
            wasmInstance,
          })
          if (err(angleLength) || !wasmInstance) return KCL_DEFAULT_LENGTH
          const { transforms } = angleLength

          // QUESTION: is it okay to reference kclManager here? will its state be up to date?
          const sketched = transformAstSketchLines({
            ast: structuredClone(machineContext.kclManager.ast),
            selectionRanges,
            transformInfos: transforms,
            memVars: machineContext.kclManager.variables,
            referenceSegName: '',
            wasmInstance,
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
        description: nodeToEditDescription,
        inputType: 'text',
        required: false,
        skip: true,
        hidden: true,
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
  Appearance: {
    description:
      'Set the appearance of a solid. This only works on solids, not sketches or individual paths.',
    icon: 'extrude',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addAppearance({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Appearance']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await context.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      objects: {
        // selectionMixed allows for feature tree selection of module imports
        inputType: 'selectionMixed',
        selectionTypes: ['path', 'sweep', 'compositeSolid'],
        selectionFilter: ['object'],
        multiple: true,
        required: true,
      },
      color: {
        inputType: 'color',
        required: true,
      },
      metalness: {
        inputType: 'kcl',
        required: false,
      },
      roughness: {
        inputType: 'kcl',
        required: false,
      },
    },
  },
  Translate: {
    description: 'Set translation on solid or sketch.',
    icon: 'move',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addTranslate({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Translate']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await context.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      objects: {
        ...objectsTypesAndFilters,
        inputType: 'selectionMixed',
        multiple: true,
        required: true,
      },
      x: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_TRANSFORM,
        required: false,
      },
      y: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_TRANSFORM,
        required: false,
      },
      z: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_TRANSFORM,
        required: false,
      },
      global: {
        inputType: 'boolean',
        required: false,
      },
    },
  },
  Rotate: {
    description: 'Set rotation on solid or sketch.',
    icon: 'rotate',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addRotate({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Rotate']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await context.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      objects: {
        ...objectsTypesAndFilters,
        inputType: 'selectionMixed',
        multiple: true,
        required: true,
      },
      roll: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_TRANSFORM,
        required: false,
      },
      pitch: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_TRANSFORM,
        required: false,
      },
      yaw: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_TRANSFORM,
        required: false,
      },
      global: {
        inputType: 'boolean',
        required: false,
      },
    },
  },
  Scale: {
    description: 'Set scale on solid or sketch.',
    icon: 'scale',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addScale({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Scale']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await context.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      objects: {
        ...objectsTypesAndFilters,
        inputType: 'selectionMixed',
        multiple: true,
        required: true,
      },
      x: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_TRANSFORM,
        required: false,
      },
      y: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_TRANSFORM,
        required: false,
      },
      z: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_TRANSFORM,
        required: false,
      },
      factor: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SCALE,
        required: false,
      },
      global: {
        inputType: 'boolean',
        required: false,
      },
    },
  },
  Clone: {
    description: 'Clone a solid or sketch.',
    icon: 'clone',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addClone({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Clone']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await kclManager.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      objects: {
        ...objectsTypesAndFilters,
        inputType: 'selectionMixed',
        multiple: false, // only one object can be cloned at this time
        required: true,
      },
      variableName: {
        inputType: 'string',
        required: true,
        defaultValue: (_, modelingContext) => {
          if (!modelingContext) {
            return KCL_DEFAULT_CONSTANT_PREFIXES.CLONE
          }
          return findUniqueName(
            modelingContext.kclManager.ast,
            KCL_DEFAULT_CONSTANT_PREFIXES.CLONE
          )
        },
        validation: async ({ data, machineContext: modelingContext }) => {
          if (!modelingContext) {
            return 'Modeling context not found'
          }
          // Be conservative and error out if there is an item or module with the same name.
          const variableExists =
            modelingContext.kclManager.variables[data] ||
            modelingContext.kclManager.variables['__mod_' + data]
          if (variableExists) {
            return 'This variable name is already in use.'
          }

          return true
        },
      },
    },
  },
  'Pattern Circular 3D': {
    description: 'Create a circular pattern of 3D solids around an axis.',
    icon: 'patternCircular3d',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addPatternCircular3D({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Pattern Circular 3D']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await context.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      solids: {
        ...objectsTypesAndFilters,
        inputType: 'selectionMixed',
        multiple: true,
        required: true,
      },
      instances: {
        inputType: 'kcl',
        required: true,
        defaultValue: KCL_DEFAULT_INSTANCES,
      },
      axis: {
        inputType: 'options',
        required: true,
        defaultValue: KCL_AXIS_Z,
        options: [
          { name: 'X-axis', value: KCL_AXIS_X },
          { name: 'Y-axis', value: KCL_AXIS_Y },
          { name: 'Z-axis', isCurrent: true, value: KCL_AXIS_Z },
        ],
      },
      center: {
        inputType: 'vector3d',
        required: true,
        defaultValue: KCL_DEFAULT_ORIGIN,
      },
      arcDegrees: {
        inputType: 'kcl',
        required: false,
        defaultValue: KCL_DEFAULT_DEGREE,
      },
      rotateDuplicates: {
        inputType: 'boolean',
        required: false,
      },
      useOriginal: {
        inputType: 'boolean',
        required: false,
      },
    },
  },
  'Pattern Linear 3D': {
    description: 'Create a linear pattern of 3D solids along an axis.',
    icon: 'patternLinear3d',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addPatternLinear3D({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Pattern Linear 3D']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await context.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      solids: {
        ...objectsTypesAndFilters,
        inputType: 'selectionMixed',
        multiple: true,
        required: true,
      },
      instances: {
        inputType: 'kcl',
        required: true,
        defaultValue: KCL_DEFAULT_INSTANCES,
      },
      distance: {
        inputType: 'kcl',
        required: true,
        defaultValue: KCL_DEFAULT_LENGTH,
      },
      axis: {
        inputType: 'options',
        required: true,
        defaultValue: KCL_AXIS_X,
        options: [
          { name: 'X-axis', isCurrent: true, value: KCL_AXIS_X },
          { name: 'Y-axis', value: KCL_AXIS_Y },
          { name: 'Z-axis', value: KCL_AXIS_Z },
        ],
      },
      useOriginal: {
        inputType: 'boolean',
        required: false,
      },
    },
  },
  'GDT Flatness': {
    description:
      'Add flatness geometric dimensioning & tolerancing annotation to faces.',
    icon: 'gdtFlatness',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addFlatnessGdt({
        ...(context.argumentsToSubmit as ModelingCommandSchema['GDT Flatness']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await context.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    status: 'experimental',
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      faces: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall', 'edgeCut'],
        multiple: true,
        required: true,
      },
      tolerance: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_TOLERANCE,
        required: true,
      },
      precision: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_PRECISION,
        required: false,
      },
      framePosition: {
        inputType: 'vector2d',
        defaultValue: KCL_DEFAULT_ORIGIN_2D,
        required: false,
      },
      framePlane: {
        inputType: 'options',
        defaultValue: KCL_PLANE_XY,
        options: [
          { name: 'XY Plane', value: KCL_PLANE_XY, isCurrent: true },
          { name: 'XZ Plane', value: KCL_PLANE_XZ },
          { name: 'YZ Plane', value: KCL_PLANE_YZ },
        ],
        required: false,
      },
      fontPointSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_POINT_SIZE,
        required: false,
      },
      fontScale: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SCALE,
        required: false,
      },
    },
  },
  'GDT Datum': {
    description:
      'Add datum geometric dimensioning & tolerancing annotation to a face.',
    icon: 'gdtDatum',
    needsReview: true,
    reviewValidation: async (context, modelingActor) => {
      if (!modelingActor) {
        return new Error('modelingMachine not found')
      }
      const { engineCommandManager, kclManager, rustContext } =
        modelingActor.getSnapshot().context
      const hasConnectionRes = hasEngineConnection(engineCommandManager)
      if (err(hasConnectionRes)) {
        return hasConnectionRes
      }
      const modRes = addDatumGdt({
        ...(context.argumentsToSubmit as ModelingCommandSchema['GDT Datum']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await context.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    status: 'experimental',
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      faces: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall', 'edgeCut'],
        multiple: false,
        required: true,
      },
      name: {
        inputType: 'string',
        defaultValue: (_, modelingContext) =>
          modelingContext
            ? getNextAvailableDatumName(modelingContext.kclManager.ast)
            : 'A',
        required: true,
      },
      framePosition: {
        inputType: 'vector2d',
        defaultValue: KCL_DEFAULT_ORIGIN_2D,
        required: false,
      },
      framePlane: {
        inputType: 'options',
        defaultValue: KCL_PLANE_XY,
        options: [
          { name: 'XY Plane', value: KCL_PLANE_XY, isCurrent: true },
          { name: 'XZ Plane', value: KCL_PLANE_XZ },
          { name: 'YZ Plane', value: KCL_PLANE_YZ },
        ],
        required: false,
      },
      fontPointSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_POINT_SIZE,
        required: false,
      },
      fontScale: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SCALE,
        required: false,
      },
    },
  },
}

modelingMachineCommandConfig // TODO: update with satisfies?
