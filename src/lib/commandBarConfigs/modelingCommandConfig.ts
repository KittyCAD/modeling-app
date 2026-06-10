import type {
  AxisDirectionPair,
  EntityType,
  OutputFormat3d,
  UnitLength,
} from '@kittycad/lib'

import { angleLengthInfo } from '@src/components/Toolbar/angleLengthInfo'
import { findUniqueName } from '@src/lang/create'
import { transformAstSketchLines } from '@src/lang/std/sketchcombos'
import type { Artifact, PathToNode } from '@src/lang/wasm'
import {
  modelingStdLibCommandArgs,
  modelingStdLibCommandStatus,
} from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type {
  CommandArgumentConfig,
  KclCommandValue,
  StateMachineCommandSetConfig,
} from '@src/lib/commandTypes'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  KCL_AXIS_X,
  KCL_AXIS_Y,
  KCL_AXIS_Z,
  KCL_DEFAULT_CONSTANT_PREFIXES,
  KCL_DEFAULT_DATUM_REFS,
  KCL_DEFAULT_DEGREE,
  KCL_DEFAULT_FONT_SIZE,
  KCL_DEFAULT_INSTANCES,
  KCL_DEFAULT_LEADER_SCALE,
  KCL_DEFAULT_LENGTH,
  KCL_DEFAULT_ORIGIN,
  KCL_DEFAULT_ORIGIN_2D,
  KCL_DEFAULT_PRECISION,
  KCL_DEFAULT_SCALE,
  KCL_DEFAULT_TOLERANCE,
  KCL_DEFAULT_TRANSFORM,
  KCL_PLANE_XY,
  KCL_PLANE_XZ,
  KCL_PLANE_YZ,
  KCL_PRELUDE_BODY_TYPE_VALUES,
  KCL_PRELUDE_EXTRUDE_METHOD_VALUES,
} from '@src/lib/constants'
import type { components } from '@src/lib/machine-api'
import { baseUnitLabels, baseUnitsUnion } from '@src/lib/settings/settingsTypes'
import { err } from '@src/lib/trap'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type {
  ModelingMachineContext,
  SketchTool,
} from '@src/machines/modelingSharedTypes'

import { mockExecAstAndReportErrors } from '@src/lang/modelingWorkflows'
import {
  addIntersect,
  addSplit,
  addSubtract,
  addUnion,
} from '@src/lang/modifyAst/boolean'
import { addBlend, addChamfer, addFillet } from '@src/lang/modifyAst/edges'
import {
  addDeleteFace,
  addHole,
  addOffsetPlane,
  addShell,
} from '@src/lang/modifyAst/faces'
import {
  addAnnotationGdt,
  addCircularityGdt,
  addCylindricityGdt,
  addDatumGdt,
  addDistanceGdt,
  addFlatnessGdt,
  addParallelismGdt,
  addPerpendicularityGdt,
  addPositionGdt,
  addProfileGdt,
  addStraightnessGdt,
  getNextAvailableDatumName,
} from '@src/lang/modifyAst/gdt'
import {
  addHelicalGear,
  addHerringboneGear,
  addRingGear,
  addSpurGear,
} from '@src/lang/modifyAst/gears'
import { addHelix } from '@src/lang/modifyAst/geometry'
import {
  addPatternCircular3D,
  addPatternLinear3D,
} from '@src/lang/modifyAst/pattern3D'
import { setExperimentalFeatures } from '@src/lang/modifyAst/settings'
import { addFlipSurface, addJoinSurfaces } from '@src/lang/modifyAst/surfaces'
import {
  addExtrude,
  addLoft,
  addRevolve,
  addSweep,
} from '@src/lang/modifyAst/sweeps'
import {
  addAppearance,
  addClone,
  addDelete,
  addMirror3D,
  addRotate,
  addScale,
  addTranslate,
} from '@src/lang/modifyAst/transforms'
import type * as StdLibCommandTypes from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import { capitaliseFC } from '@src/lib/utils'
import type { ConnectionManager } from '@src/network/connectionManager'

export type { HelixModes } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'

type OutputFormat = OutputFormat3d
type OutputTypeKey = OutputFormat['type']
type ExtractStorageTypes<T> = T extends { storage: infer U } ? U : never
type StorageUnion = ExtractStorageTypes<OutputFormat>
type ExportOptionalArg = 'up' | 'scale'

const exportOptionalArgSupportByType: Partial<
  Record<OutputTypeKey, Partial<Record<ExportOptionalArg, boolean>>>
> = {
  gltf: {
    up: false,
    scale: false,
  },
}

function isExportOptionalArgSupported(
  exportType: unknown,
  arg: ExportOptionalArg
): boolean {
  if (typeof exportType !== 'string') return true
  const supportByArg =
    exportOptionalArgSupportByType[exportType as OutputTypeKey]
  return supportByArg?.[arg] ?? true
}

export const EXTRUSION_RESULTS = [
  'new',
  'add',
  'subtract',
  'intersect',
] as const

export const COMMAND_APPEARANCE_COLOR_DEFAULT = 'default'

const FRAME_PLANE_OPTIONS = Object.freeze([
  Object.freeze({ name: 'XY Plane', value: KCL_PLANE_XY, isCurrent: true }),
  Object.freeze({ name: 'XZ Plane', value: KCL_PLANE_XZ }),
  Object.freeze({ name: 'YZ Plane', value: KCL_PLANE_YZ }),
] as const)

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

// Edit flows pass this as hidden command-bar metadata, not as a KCL stdlib arg.
type CommandBarEditFlowArgs = {
  nodeToEdit?: PathToNode
}

type WithCommandBarEditFlowArgs<Schema> = {
  [CommandName in keyof Schema]: Schema[CommandName] & CommandBarEditFlowArgs
}

type EditableStdLibModelingCommandSchema = WithCommandBarEditFlowArgs<{
  Extrude: StdLibCommandTypes.ExtrudeCommandArgs
  Sweep: StdLibCommandTypes.SweepCommandArgs
  Loft: StdLibCommandTypes.LoftCommandArgs
  Revolve: StdLibCommandTypes.RevolveCommandArgs
  Shell: StdLibCommandTypes.ShellCommandArgs
  Hole: StdLibCommandTypes.HoleCommandArgs
  Fillet: StdLibCommandTypes.FilletCommandArgs
  Chamfer: StdLibCommandTypes.ChamferCommandArgs
  'Offset plane': StdLibCommandTypes.OffsetPlaneCommandArgs
  Helix: StdLibCommandTypes.HelixCommandArgs
  'Helical Gear': StdLibCommandTypes.HelicalGearCommandArgs
  'Herringbone Gear': StdLibCommandTypes.HerringboneGearCommandArgs
  'Spur Gear': StdLibCommandTypes.SpurGearCommandArgs
  'Ring Gear': StdLibCommandTypes.RingGearCommandArgs
  Appearance: StdLibCommandTypes.AppearanceCommandArgs
  Translate: StdLibCommandTypes.TranslateCommandArgs
  Rotate: StdLibCommandTypes.RotateCommandArgs
  Scale: StdLibCommandTypes.ScaleCommandArgs
  Clone: StdLibCommandTypes.CloneCommandArgs
  'Pattern Circular 3D': StdLibCommandTypes.PatternCircular3DCommandArgs
  'Pattern Linear 3D': StdLibCommandTypes.PatternLinear3DCommandArgs
  'GDT Flatness': StdLibCommandTypes.GdtFlatnessCommandArgs
  'GDT Straightness': StdLibCommandTypes.GdtStraightnessCommandArgs
  'GDT Circularity': StdLibCommandTypes.GdtCircularityCommandArgs
  'GDT Cylindricity': StdLibCommandTypes.GdtCylindricityCommandArgs
  'GDT Position': StdLibCommandTypes.GdtPositionCommandArgs
  'GDT Profile': StdLibCommandTypes.GdtProfileCommandArgs
  'GDT Distance': StdLibCommandTypes.GdtDistanceCommandArgs
  'GDT Perpendicularity': StdLibCommandTypes.GdtPerpendicularityCommandArgs
  'GDT Parallelism': StdLibCommandTypes.GdtParallelismCommandArgs
  'GDT Annotation': StdLibCommandTypes.GdtAnnotationCommandArgs
  'GDT Datum': StdLibCommandTypes.GdtDatumCommandArgs
  'Boolean Split': StdLibCommandTypes.BooleanSplitCommandArgs
}>

export type ModelingCommandSchema = {
  'Enter sketch': { forceNewSketch?: boolean }
  Export: {
    type: OutputTypeKey
    storage?: StorageUnion
    up?: AxisDirectionPair['axis']
    scale?: UnitLength
  }
  Make: {
    machine: components['schemas']['MachineInfoResponse']
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
  Delete: {
    objects: Selections
  }
  // TODO: {} means any non-nullish value. This is probably not what we want.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  'Delete selection': {}
  'Mirror 3D': StdLibCommandTypes.Mirror3DCommandArgs
  'Boolean Subtract': StdLibCommandTypes.BooleanSubtractCommandArgs
  'Boolean Union': StdLibCommandTypes.BooleanUnionCommandArgs
  'Boolean Intersect': StdLibCommandTypes.BooleanIntersectCommandArgs
  'Flip Surface': StdLibCommandTypes.FlipSurfaceCommandArgs
  'Delete Face': StdLibCommandTypes.DeleteFaceCommandArgs
  Blend: StdLibCommandTypes.BlendCommandArgs
  'Join Surfaces': StdLibCommandTypes.JoinSurfacesCommandArgs
} & EditableStdLibModelingCommandSchema

const kclDatumArrayToInput = (value: string) => {
  const trimmed = value.trim()
  const quotedDatumRefs = [...trimmed.matchAll(/["']([^"']+)["']/g)].map(
    ([, datumRef]) => datumRef
  )
  if (quotedDatumRefs.length > 0) {
    return quotedDatumRefs.join(', ')
  }

  return trimmed
}

const datumInputToKclArray = (value: string) => {
  const trimmed = value.trim()
  if (
    trimmed === '' ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('"') ||
    trimmed.startsWith("'")
  ) {
    return trimmed
  }

  const datumRefs = trimmed
    .split(',')
    .map((datumRef) => datumRef.trim())
    .filter(Boolean)
  const isDatumRefList = datumRefs.every((datumRef) =>
    /^[A-Z][A-Z0-9_-]*$/.test(datumRef)
  )
  if (!isDatumRefList) {
    return trimmed
  }

  return `[${datumRefs.map((datumRef) => JSON.stringify(datumRef)).join(', ')}]`
}

const isKclCommandValue = (value: unknown): value is KclCommandValue =>
  Boolean(
    value &&
      typeof value === 'object' &&
      'valueText' in value &&
      'valueCalculated' in value
  )

const summarizeDatumKclValue = (value: unknown) =>
  isKclCommandValue(value)
    ? kclDatumArrayToInput(
        value.valueCalculated === 'NAN'
          ? value.valueText
          : value.valueCalculated
      )
    : ''

export const getDefaultGdtTolerance = (
  _commandBarContext: unknown,
  modelingContext?: ModelingMachineContext
) => {
  const defaultLengthUnit =
    modelingContext?.kclManager.fileSettings.defaultLengthUnit ||
    DEFAULT_DEFAULT_LENGTH_UNIT
  return `${KCL_DEFAULT_TOLERANCE}${defaultLengthUnit}`
}

const summarizeGdtToleranceKclValue = (value: unknown) =>
  isKclCommandValue(value) ? value.valueText : ''

const gdtToleranceProps = {
  inputType: 'kcl',
  defaultValue: getDefaultGdtTolerance,
  valueSummary: summarizeGdtToleranceKclValue,
  required: true,
} satisfies CommandArgumentConfig<KclCommandValue, ModelingMachineContext>

const datumsProps = {
  inputType: 'kcl',
  defaultValue: KCL_DEFAULT_DATUM_REFS,
  allowArrays: true,
  allowStringArrays: true,
  allowUncalculated: true,
  inputToKclValue: datumInputToKclArray,
  kclValueToInput: kclDatumArrayToInput,
  valueSummary: summarizeDatumKclValue,
  required: false,
} satisfies CommandArgumentConfig<KclCommandValue, ModelingMachineContext>

const gdtFrameDisplayArgOverrides = {
  framePosition: {
    defaultValue: KCL_DEFAULT_ORIGIN_2D,
  },
  framePlane: {
    inputType: 'options',
    defaultValue: KCL_PLANE_XY,
    options: FRAME_PLANE_OPTIONS,
  },
  leaderScale: {
    defaultValue: KCL_DEFAULT_LEADER_SCALE,
  },
  fontSize: {
    defaultValue: KCL_DEFAULT_FONT_SIZE,
  },
} as const

const gdtFrameArgOverrides = {
  precision: {
    defaultValue: KCL_DEFAULT_PRECISION,
  },
  ...gdtFrameDisplayArgOverrides,
} as const

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
      up: {
        inputType: 'options',
        displayName: 'Up',
        required: false,
        prepopulate: true,
        hidden: (commandContext) =>
          !isExportOptionalArgSupported(
            commandContext.argumentsToSubmit.type,
            'up'
          ),
        defaultValue: 'z',
        options: (commandContext) => {
          const currentUp =
            (commandContext.argumentsToSubmit.up as
              | AxisDirectionPair['axis']
              | undefined) ?? 'z'
          return [
            { name: 'Z+', isCurrent: currentUp === 'z', value: 'z' },
            { name: 'Y+', isCurrent: currentUp === 'y', value: 'y' },
          ]
        },
        valueSummary: (value) =>
          value === undefined ? 'Z+' : `${value.toUpperCase()}+`,
      },
      scale: {
        inputType: 'options',
        displayName: 'Scale',
        required: false,
        prepopulate: true,
        hidden: (commandContext) =>
          !isExportOptionalArgSupported(
            commandContext.argumentsToSubmit.type,
            'scale'
          ),
        defaultValue: (commandContext) => {
          const machineContext =
            commandContext.selectedCommand?.machineActor?.getSnapshot()
              .context as ModelingMachineContext | undefined
          return (
            machineContext?.store.defaultUnit?.current ??
            DEFAULT_DEFAULT_LENGTH_UNIT
          )
        },
        options: (commandContext, machineContext) => {
          const submittedScale = commandContext.argumentsToSubmit.scale
          const resolvedSubmittedScale =
            typeof submittedScale === 'function'
              ? (
                  submittedScale as (
                    context: typeof commandContext
                  ) => UnitLength
                )(commandContext)
              : (submittedScale as UnitLength | undefined)

          const currentScale =
            resolvedSubmittedScale ??
            machineContext?.store.defaultUnit?.current ??
            DEFAULT_DEFAULT_LENGTH_UNIT

          return baseUnitsUnion.map((unit) => ({
            name: baseUnitLabels[unit],
            value: unit,
            isCurrent: unit === currentScale,
          }))
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Extrude']>(
      'Extrude',
      {
        overrides: {
          sketches: {
            inputType: 'selection',
            displayName: 'Profiles',
            selectionTypes: [
              'solid2d',
              'segment',
              'cap',
              'wall',
              'pathRegion',
              'engineRegion',
            ],
            multiple: true,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          length: {
            defaultValue: KCL_DEFAULT_LENGTH,
            prepopulate: true,
          },
          to: {
            inputType: 'selection',
            // TODO: add edgeCut during https://github.com/KittyCAD/modeling-app/issues/8831
            selectionTypes: ['cap', 'wall'],
            clearSelectionFirst: true,
            multiple: false,
            description: 'Only parallel faces are supported for now.',
          },
          tagStart: {
            // TODO: add validation like for Clone command
          },
          twistCenter: {
            defaultValue: KCL_DEFAULT_ORIGIN_2D,
          },
          method: {
            inputType: 'options',
            options: KCL_PRELUDE_EXTRUDE_METHOD_VALUES.map((value) => ({
              name: capitaliseFC(value.toLowerCase()),
              value,
            })),
          },
          bodyType: {
            inputType: 'options',
            options: kclBodyTypeOptions,
          },
        },
      }
    ),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Sweep']>('Sweep', {
      overrides: {
        sketches: {
          inputType: 'selection',
          displayName: 'Profiles',
          selectionTypes: ['solid2d', 'segment', 'pathRegion', 'engineRegion'],
          multiple: true,
          hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
        },
        path: {
          inputType: 'selection',
          selectionTypes: ['segment', 'path', 'helix'],
          clearSelectionFirst: true,
          multiple: true,
          hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
        },
        relativeTo: {
          inputType: 'options',
          options: [
            { name: 'Sketch Plane', value: 'SKETCH_PLANE' },
            { name: 'Trajectory Curve', value: 'TRAJECTORY' },
          ],
        },
        bodyType: {
          inputType: 'options',
          options: kclBodyTypeOptions,
        },
      },
    }),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Loft']>('Loft', {
      overrides: {
        sketches: {
          inputType: 'selection',
          displayName: 'Profiles',
          selectionTypes: ['solid2d', 'segment', 'pathRegion', 'engineRegion'],
          multiple: true,
          hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
        },
        bodyType: {
          inputType: 'options',
          options: kclBodyTypeOptions,
        },
      },
    }),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Revolve']>(
      'Revolve',
      {
        overrides: {
          sketches: {
            inputType: 'selection',
            displayName: 'Profiles',
            selectionTypes: [
              'solid2d',
              'segment',
              'pathRegion',
              'engineRegion',
            ],
            multiple: true,
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
              !['Axis'].includes(
                context.argumentsToSubmit.axisOrEdge as string
              ),
          },
          edge: {
            required: (context) =>
              ['Edge'].includes(context.argumentsToSubmit.axisOrEdge as string),
            inputType: 'selection',
            selectionTypes: ['segment', 'sweepEdge', 'edgeCutEdge'],
            multiple: false,
            hidden: (context) =>
              Boolean(context.argumentsToSubmit.nodeToEdit) ||
              !['Edge'].includes(
                context.argumentsToSubmit.axisOrEdge as string
              ),
          },
          angle: {
            defaultValue: KCL_DEFAULT_DEGREE,
          },
          bodyType: {
            inputType: 'options',
            options: kclBodyTypeOptions,
          },
        },
      }
    ),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Shell']>('Shell', {
      overrides: {
        faces: {
          inputType: 'selection',
          selectionTypes: ['cap', 'wall'],
          multiple: true,
          hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
        },
        thickness: {
          defaultValue: KCL_DEFAULT_LENGTH,
        },
      },
    }),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Hole']>('Hole', {
      overrides: {
        face: {
          inputType: 'selection',
          selectionTypes: ['cap', 'wall', 'edgeCut'],
          multiple: false,
          hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
        },
        cutAt: {
          defaultValue: KCL_DEFAULT_ORIGIN_2D,
        },
        holeBody: {
          inputType: 'options',
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
        countersinkHeadClearance: {
          inputType: 'kcl',
          required: false,
          hidden: (context) =>
            !['countersink'].includes(
              context.argumentsToSubmit.holeType as string
            ),
          defaultValue: '0',
        },
        holeBottom: {
          inputType: 'options',
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
    }),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Boolean Subtract']>(
      'Boolean Subtract',
      {
        overrides: {
          solids: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            multiple: true,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          tools: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            clearSelectionFirst: true,
            multiple: true,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
        },
      }
    ),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Boolean Union']>(
      'Boolean Union',
      {
        overrides: {
          solids: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            multiple: true,
            skip: false,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
        },
      }
    ),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Boolean Intersect']>(
      'Boolean Intersect',
      {
        overrides: {
          solids: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            multiple: true,
            skip: false,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
        },
      }
    ),
  },
  'Boolean Split': {
    description:
      "Split a target body into two parts: the part that overlaps with the tool, and the part that doesn't.",
    icon: 'split',
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
      const modRes = addSplit({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Boolean Split']),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Boolean Split']>(
      'Boolean Split',
      {
        overrides: {
          targets: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            multiple: true,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          tools: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            clearSelectionFirst: true,
            multiple: true,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
        },
      }
    ),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Offset plane']>(
      'Offset plane',
      {
        overrides: {
          plane: {
            inputType: 'selection',
            selectionTypes: [
              'plane',
              'planeOfFace',
              'cap',
              'wall',
              'edgeCut',
              'enginePrimitiveFace',
              'primitiveFace',
            ],
            multiple: false,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          offset: {
            defaultValue: KCL_DEFAULT_LENGTH,
          },
        },
      }
    ),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Helix']>('Helix', {
      overrides: {
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
          defaultValue: '1',
        },
        angleStart: {
          defaultValue: KCL_DEFAULT_DEGREE,
        },
        radius: {
          defaultValue: KCL_DEFAULT_LENGTH,
          required: (context) =>
            !['Cylinder'].includes(context.argumentsToSubmit.mode as string),
          hidden: (context) =>
            ['Cylinder'].includes(context.argumentsToSubmit.mode as string),
        },
        length: {
          defaultValue: KCL_DEFAULT_LENGTH,
          required: (commandContext) =>
            ['Axis'].includes(commandContext.argumentsToSubmit.mode as string),
          // No need for hidden here, as it works with all modes
        },
        ccw: {
          displayName: 'CounterClockWise',
        },
      },
    }),
  },
  'Helical Gear': {
    description: 'Create a helical gear.',
    icon: 'gear',
    needsReview: true,
    status: modelingStdLibCommandStatus('Helical Gear'),
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
      const modRes = addHelicalGear({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Helical Gear']),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Helical Gear']>(
      'Helical Gear',
      {
        overrides: {
          nTeeth: {
            defaultValue: '10',
          },
          module: {
            defaultValue: '2',
          },
          pressureAngle: {
            defaultValue: '20deg',
          },
          helixAngle: {
            defaultValue: '35deg',
          },
          gearHeight: {
            defaultValue: '7',
          },
        },
      }
    ),
  },
  'Herringbone Gear': {
    description: 'Create a herringbone gear.',
    icon: 'gear',
    needsReview: true,
    status: modelingStdLibCommandStatus('Herringbone Gear'),
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
      const modRes = addHerringboneGear({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Herringbone Gear']),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Herringbone Gear']>(
      'Herringbone Gear',
      {
        overrides: {
          nTeeth: {
            defaultValue: '10',
          },
          module: {
            defaultValue: '2',
          },
          pressureAngle: {
            defaultValue: '20deg',
          },
          gearHeight: {
            defaultValue: '5',
          },
          helixAngle: {
            defaultValue: '40deg',
          },
        },
      }
    ),
  },
  'Spur Gear': {
    description: 'Create a spur gear.',
    icon: 'gear',
    needsReview: true,
    status: modelingStdLibCommandStatus('Spur Gear'),
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
      const modRes = addSpurGear({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Spur Gear']),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Spur Gear']>(
      'Spur Gear',
      {
        overrides: {
          nTeeth: {
            defaultValue: '21',
          },
          module: {
            defaultValue: '1.5',
          },
          pressureAngle: {
            defaultValue: '14deg',
          },
          gearHeight: {
            defaultValue: '6',
          },
        },
      }
    ),
  },
  'Ring Gear': {
    description: 'Create a ring gear.',
    icon: 'gear',
    needsReview: true,
    status: modelingStdLibCommandStatus('Ring Gear'),
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
      const modRes = addRingGear({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Ring Gear']),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Ring Gear']>(
      'Ring Gear',
      {
        overrides: {
          nTeeth: {
            defaultValue: '40',
          },
          module: {
            defaultValue: '1.5',
          },
          pressureAngle: {
            defaultValue: '14deg',
          },
          helixAngle: {
            defaultValue: '-25deg',
          },
          gearHeight: {
            defaultValue: '5',
          },
        },
      }
    ),
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
      const commandArgs =
        context.argumentsToSubmit as ModelingCommandSchema['Fillet']
      const wasmInstance = await kclManager.wasmInstancePromise
      let ast = kclManager.ast
      if (
        commandArgs.version &&
        kclManager.fileSettings.experimentalFeatures?.type !== 'Allow'
      ) {
        const astWithNewSetting = setExperimentalFeatures(
          kclManager.code,
          {
            type: 'Allow',
          },
          wasmInstance
        )
        if (err(astWithNewSetting)) return astWithNewSetting
        ast = astWithNewSetting
      }
      const modRes = addFillet({
        ...commandArgs,
        ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Fillet']>('Fillet', {
      overrides: {
        selection: {
          inputType: 'selection',
          selectionTypes: [
            'segment',
            'sweepEdge',
            'primitiveEdge',
            'enginePrimitiveEdge',
          ],
          multiple: true,
          skip: false,
          hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
        },
        radius: {
          defaultValue: KCL_DEFAULT_LENGTH,
        },
        version: {
          description:
            'Edge cut algorithm version. 0 lets the engine choose; 1 is original; 2 is newer.',
          defaultValue: '1',
        },
      },
    }),
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
      const commandArgs =
        context.argumentsToSubmit as ModelingCommandSchema['Chamfer']
      const wasmInstance = await kclManager.wasmInstancePromise
      let ast = kclManager.ast
      if (
        commandArgs.version &&
        kclManager.fileSettings.experimentalFeatures?.type !== 'Allow'
      ) {
        const astWithNewSetting = setExperimentalFeatures(
          kclManager.code,
          {
            type: 'Allow',
          },
          wasmInstance
        )
        if (err(astWithNewSetting)) return astWithNewSetting
        ast = astWithNewSetting
      }
      const modRes = addChamfer({
        ...commandArgs,
        ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance,
      })
      if (err(modRes)) return modRes
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) return execRes
    },
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Chamfer']>(
      'Chamfer',
      {
        overrides: {
          selection: {
            inputType: 'selection',
            selectionTypes: [
              'segment',
              'sweepEdge',
              'primitiveEdge',
              'enginePrimitiveEdge',
            ],
            multiple: true,
            skip: false,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          length: {
            defaultValue: KCL_DEFAULT_LENGTH,
          },
          secondLength: {
            defaultValue: KCL_DEFAULT_LENGTH,
          },
          angle: {
            defaultValue: KCL_DEFAULT_DEGREE,
          },
          version: {
            description:
              'Edge cut algorithm version. 0 lets the engine choose; 1 is original; 2 is newer.',
            defaultValue: '1',
          },
        },
      }
    ),
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
        description: 'Current value metadata. Never shown to the user.',
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Appearance']>(
      'Appearance',
      {
        overrides: {
          objects: {
            // selectionMixed allows for feature tree selection of module imports
            inputType: 'selectionMixed',
            selectionTypes: ['path', 'sweep', 'compositeSolid'],
            selectionFilter: ['object'],
            multiple: true,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          color: {
            inputType: 'color',
          },
        },
      }
    ),
  },
  Delete: {
    description: 'Delete selected bodies from the scene.',
    icon: 'trash',
    needsReview: true,
    status: 'experimental',
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

      let ast = kclManager.ast
      if (kclManager.fileSettings.experimentalFeatures?.type !== 'Allow') {
        const astWithExperimentalFeatures = setExperimentalFeatures(
          kclManager.code,
          {
            type: 'Allow',
          },
          await kclManager.wasmInstancePromise
        )
        if (err(astWithExperimentalFeatures)) {
          return astWithExperimentalFeatures
        }

        ast = astWithExperimentalFeatures
      }

      const modRes = addDelete({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Delete']),
        ast,
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
      objects: {
        ...objectsTypesAndFilters,
        inputType: 'selectionMixed',
        multiple: true,
        required: true,
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Translate']>(
      'Translate',
      {
        overrides: {
          objects: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            multiple: true,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          x: {
            defaultValue: KCL_DEFAULT_TRANSFORM,
          },
          y: {
            defaultValue: KCL_DEFAULT_TRANSFORM,
          },
          z: {
            defaultValue: KCL_DEFAULT_TRANSFORM,
          },
        },
      }
    ),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Rotate']>('Rotate', {
      overrides: {
        objects: {
          ...objectsTypesAndFilters,
          inputType: 'selectionMixed',
          multiple: true,
          hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
        },
        roll: {
          defaultValue: KCL_DEFAULT_TRANSFORM,
        },
        pitch: {
          defaultValue: KCL_DEFAULT_TRANSFORM,
        },
        yaw: {
          defaultValue: KCL_DEFAULT_TRANSFORM,
        },
      },
    }),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Scale']>('Scale', {
      overrides: {
        objects: {
          ...objectsTypesAndFilters,
          inputType: 'selectionMixed',
          multiple: true,
          hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
        },
        x: {
          defaultValue: KCL_DEFAULT_SCALE,
        },
        y: {
          defaultValue: KCL_DEFAULT_SCALE,
        },
        z: {
          defaultValue: KCL_DEFAULT_SCALE,
        },
        factor: {
          defaultValue: KCL_DEFAULT_SCALE,
        },
      },
    }),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Clone']>('Clone', {
      overrides: {
        objects: {
          ...objectsTypesAndFilters,
          inputType: 'selectionMixed',
          multiple: false, // only one object can be cloned at this time
          hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
        },
        variableName: {
          inputType: 'string',
          required: true,
          defaultValue: (
            _: unknown,
            modelingContext?: ModelingMachineContext
          ) => {
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
    }),
  },
  'Mirror 3D': {
    description: 'Mirror solids across a plane or edge.',
    icon: 'mirror3d',
    displayName: 'Mirror',
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
      const modRes = addMirror3D({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Mirror 3D']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        variables: kclManager.variables,
        wasmInstance: await kclManager.wasmInstancePromise,
      })
      if (err(modRes)) {
        return modRes
      }
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) {
        return execRes
      }
    },
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Mirror 3D']>(
      'Mirror 3D',
      {
        overrides: {
          bodies: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            multiple: true,
          },
          across: {
            inputType: 'selection',
            selectionTypes: [
              'plane',
              'cap',
              'wall',
              'edgeCut',
              'enginePrimitiveFace',
              'segment',
              'sweepEdge',
              'edgeCutEdge',
            ],
            clearSelectionFirst: true,
            multiple: false,
          },
        },
      }
    ),
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
    args: modelingStdLibCommandArgs<
      ModelingCommandSchema['Pattern Circular 3D']
    >('Pattern Circular 3D', {
      overrides: {
        solids: {
          ...objectsTypesAndFilters,
          inputType: 'selectionMixed',
          multiple: true,
          hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
        },
        instances: {
          defaultValue: KCL_DEFAULT_INSTANCES,
        },
        axis: {
          inputType: 'options',
          defaultValue: KCL_AXIS_Z,
          options: [
            { name: 'X-axis', value: KCL_AXIS_X },
            { name: 'Y-axis', value: KCL_AXIS_Y },
            { name: 'Z-axis', isCurrent: true, value: KCL_AXIS_Z },
          ],
        },
        center: {
          defaultValue: KCL_DEFAULT_ORIGIN,
        },
        arcDegrees: {
          defaultValue: KCL_DEFAULT_DEGREE,
        },
      },
    }),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Pattern Linear 3D']>(
      'Pattern Linear 3D',
      {
        overrides: {
          solids: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            multiple: true,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          instances: {
            defaultValue: KCL_DEFAULT_INSTANCES,
          },
          distance: {
            defaultValue: KCL_DEFAULT_LENGTH,
          },
          axis: {
            inputType: 'options',
            defaultValue: KCL_AXIS_X,
            options: [
              { name: 'X-axis', isCurrent: true, value: KCL_AXIS_X },
              { name: 'Y-axis', value: KCL_AXIS_Y },
              { name: 'Z-axis', value: KCL_AXIS_Z },
            ],
          },
        },
      }
    ),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Flatness']>(
      'GDT Flatness',
      {
        overrides: {
          faces: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut'],
            multiple: true,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          tolerance: gdtToleranceProps,
          ...gdtFrameArgOverrides,
        },
      }
    ),
  },
  'GDT Straightness': {
    description:
      'Add straightness geometric dimensioning & tolerancing annotation to faces and edges.',
    icon: 'gdtStraightness',
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
      const modRes = addStraightnessGdt({
        ...(context.argumentsToSubmit as ModelingCommandSchema['GDT Straightness']),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Straightness']>(
      'GDT Straightness',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
            multiple: true,
            required: true,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          tolerance: gdtToleranceProps,
          ...gdtFrameArgOverrides,
        },
      }
    ),
  },
  'GDT Circularity': {
    description:
      'Add circularity geometric dimensioning & tolerancing annotation to faces and edges.',
    icon: 'gdtCircularity',
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
      const modRes = addCircularityGdt({
        ...(context.argumentsToSubmit as ModelingCommandSchema['GDT Circularity']),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Circularity']>(
      'GDT Circularity',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
            multiple: true,
            required: true,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          tolerance: gdtToleranceProps,
          ...gdtFrameArgOverrides,
        },
      }
    ),
  },
  'GDT Cylindricity': {
    description:
      'Add cylindricity geometric dimensioning & tolerancing annotation to faces and edges.',
    icon: 'gdtCylindricity',
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
      const modRes = addCylindricityGdt({
        ...(context.argumentsToSubmit as ModelingCommandSchema['GDT Cylindricity']),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Cylindricity']>(
      'GDT Cylindricity',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
            multiple: true,
            required: true,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          tolerance: gdtToleranceProps,
          ...gdtFrameArgOverrides,
        },
      }
    ),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Datum']>(
      'GDT Datum',
      {
        overrides: {
          faces: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut'],
            multiple: false,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          name: {
            defaultValue: (_, modelingContext) =>
              modelingContext
                ? getNextAvailableDatumName(modelingContext.kclManager.ast)
                : 'A',
          },
          ...gdtFrameDisplayArgOverrides,
        },
      }
    ),
  },
  'GDT Position': {
    description:
      'Add position geometric dimensioning & tolerancing annotation to faces and edges.',
    icon: 'gdtPosition',
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
      const modRes = addPositionGdt({
        ...(context.argumentsToSubmit as ModelingCommandSchema['GDT Position']),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Position']>(
      'GDT Position',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
            multiple: true,
            required: true,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          datums: datumsProps,
          tolerance: gdtToleranceProps,
          ...gdtFrameArgOverrides,
        },
      }
    ),
  },
  'GDT Profile': {
    description:
      'Add profile geometric dimensioning & tolerancing annotation to edges.',
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
      const modRes = addProfileGdt({
        ...(context.argumentsToSubmit as ModelingCommandSchema['GDT Profile']),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Profile']>(
      'GDT Profile',
      {
        overrides: {
          edges: {
            inputType: 'selection',
            selectionTypes: ['segment', 'sweepEdge'],
            multiple: true,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          datums: datumsProps,
          tolerance: gdtToleranceProps,
          ...gdtFrameArgOverrides,
        },
      }
    ),
  },
  'GDT Distance': {
    description:
      'Add an MBD distance annotation to an edge length or between two faces or edges.',
    icon: 'dimension',
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
      const modRes = addDistanceGdt({
        ...(context.argumentsToSubmit as ModelingCommandSchema['GDT Distance']),
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await context.wasmInstancePromise,
      })
      if (err(modRes)) {
        return modRes
      }
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) {
        return execRes
      }
    },
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Distance']>(
      'GDT Distance',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
            multiple: true,
            required: true,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          tolerance: gdtToleranceProps,
          ...gdtFrameArgOverrides,
        },
      }
    ),
  },
  'GDT Perpendicularity': {
    description:
      'Add perpendicularity geometric dimensioning & tolerancing annotation to faces and edges.',
    icon: 'perpendicular',
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
      const modRes = addPerpendicularityGdt({
        ...(context.argumentsToSubmit as ModelingCommandSchema['GDT Perpendicularity']),
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
    args: modelingStdLibCommandArgs<
      ModelingCommandSchema['GDT Perpendicularity']
    >('GDT Perpendicularity', {
      overrides: {
        objects: {
          inputType: 'selection',
          selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
          multiple: true,
          required: true,
          hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
        },
        datums: datumsProps,
        tolerance: gdtToleranceProps,
        ...gdtFrameArgOverrides,
      },
    }),
  },
  'GDT Parallelism': {
    description:
      'Add parallelism geometric dimensioning & tolerancing annotation to faces and edges.',
    icon: 'parallel',
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
      const modRes = addParallelismGdt({
        ...(context.argumentsToSubmit as ModelingCommandSchema['GDT Parallelism']),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Parallelism']>(
      'GDT Parallelism',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
            multiple: true,
            required: true,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          datums: datumsProps,
          tolerance: gdtToleranceProps,
          ...gdtFrameArgOverrides,
        },
      }
    ),
  },
  'GDT Annotation': {
    description: 'Add model-based definition annotation to faces and edges.',
    icon: 'text',
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
      const modRes = addAnnotationGdt({
        ...(context.argumentsToSubmit as ModelingCommandSchema['GDT Annotation']),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Annotation']>(
      'GDT Annotation',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
            multiple: true,
            required: true,
            hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
          },
          annotation: {
            inputType: 'text',
            defaultValue: 'BREAK ALL SHARP EDGES',
          },
          ...gdtFrameDisplayArgOverrides,
        },
      }
    ),
  },
  'Flip Surface': {
    description:
      'Flips the orientation of a surface, swapping which side is the front and which is the reverse.',
    icon: 'flipSurface',
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
      const modRes = addFlipSurface({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Flip Surface']),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Flip Surface']>(
      'Flip Surface',
      {
        overrides: {
          surface: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            multiple: true,
          },
        },
      }
    ),
  },
  'Join Surfaces': {
    description: 'Join selected surfaces into one polysurface.',
    icon: 'joinSurfaces',
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
      const modRes = addJoinSurfaces({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Join Surfaces']),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Join Surfaces']>(
      'Join Surfaces',
      {
        overrides: {
          selection: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            multiple: true,
          },
        },
      }
    ),
  },
  'Delete Face': {
    description: 'Delete a face from a body, leaving an open surface.',
    icon: 'deleteFace',
    needsReview: true,
    status: 'experimental',
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
      const modRes = addDeleteFace({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Delete Face']),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Delete Face']>(
      'Delete Face',
      {
        overrides: {
          faces: {
            inputType: 'selection',
            selectionTypes: [
              'cap',
              'wall',
              'primitiveFace',
              'enginePrimitiveFace',
            ],
            multiple: true,
            required: true,
          },
        },
      }
    ),
  },
  Blend: {
    description: 'Blend two selected surface edges into a new surface.',
    icon: 'blend',
    needsReview: true,
    status: 'experimental',
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
      const modRes = addBlend({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Blend']),
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
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Blend']>('Blend', {
      overrides: {
        edges: {
          inputType: 'selection',
          selectionTypes: [
            'segment',
            'sweepEdge',
            'primitiveEdge',
            'enginePrimitiveEdge',
          ],
          multiple: true,
          description: 'Only straight edges are supported now.',
        },
      },
    }),
  },
}

// TODO: update modelingMachineCommandConfig with satisfies?
