import type {
  AxisDirectionPair,
  EntityType,
  OutputFormat3d,
  UnitLength,
} from '@kittycad/lib'

import { angleLengthInfo } from '@src/components/Toolbar/angleLengthInfo'
import { findUniqueName } from '@src/lang/create'
import { createModelingCodemodReviewValidation } from '@src/lang/modifyAst/modelingCodemod'
import { transformAstSketchLines } from '@src/lang/std/sketchcombos'
import type { Artifact, PathToNode } from '@src/lang/wasm'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
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
import { isEnginePrimitiveSelection } from '@src/lib/selections'
import { baseUnitLabels, baseUnitsUnion } from '@src/lib/settings/settingsTypes'
import { err } from '@src/lib/trap'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type {
  ModelingMachineContext,
  SketchTool,
} from '@src/machines/modelingSharedTypes'

import { getNextAvailableDatumName } from '@src/lang/modifyAst/gdt'
import type { StdLibModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import { capitaliseFC, isArray } from '@src/lib/utils'

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

function isSelections(value: unknown): value is Selections {
  return (
    typeof value === 'object' &&
    value !== null &&
    'graphSelections' in value &&
    isArray(value.graphSelections) &&
    'otherSelections' in value &&
    isArray(value.otherSelections)
  )
}

function isExtrudeRequirementKclCommandValue(
  value: unknown
): value is KclCommandValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'valueAst' in value &&
    'valueText' in value &&
    'valueCalculated' in value
  )
}

export function profileSelectionRequiresBodyType({
  argumentsToSubmit,
}: {
  argumentsToSubmit: Record<string, unknown>
}): boolean {
  const sketches = argumentsToSubmit.sketches
  if (!isSelections(sketches)) return false

  const hasOpenGraphSelection = sketches.graphSelections.some(
    (selection) =>
      !selection.artifact ||
      selection.artifact.type === 'segment' ||
      selection.artifact.type === 'sweepEdge' ||
      selection.artifact.type === 'primitiveEdge'
  )

  return (
    hasOpenGraphSelection ||
    sketches.otherSelections.some(
      (selection) =>
        isEnginePrimitiveSelection(selection) &&
        selection.primitiveType === 'edge'
    )
  )
}

export function extrudeSelectionRequiresBodyType(context: {
  argumentsToSubmit: Record<string, unknown>
}): boolean {
  if (!isExtrudeRequirementKclCommandValue(context.argumentsToSubmit.length)) {
    return false
  }

  return profileSelectionRequiresBodyType(context)
}

export function extrudeSelectionRequiresMethod({
  argumentsToSubmit,
}: {
  argumentsToSubmit: Record<string, unknown>
}): boolean {
  if (!isExtrudeRequirementKclCommandValue(argumentsToSubmit.length)) {
    return false
  }

  const sketches = argumentsToSubmit.sketches
  if (!isSelections(sketches)) return false

  return (
    sketches.graphSelections.some(
      (selection) =>
        selection.artifact?.type === 'sweepEdge' ||
        selection.artifact?.type === 'primitiveEdge'
    ) ||
    sketches.otherSelections.some(
      (selection) =>
        isEnginePrimitiveSelection(selection) &&
        selection.primitiveType === 'edge'
    )
  )
}

// Edit flows pass this as hidden command-bar metadata, not as a KCL stdlib arg.
type CommandBarEditFlowArgs = {
  nodeToEdit?: PathToNode
}

type WithCommandBarEditFlowArgs<Schema> = {
  [CommandName in keyof Schema]: Schema[CommandName] & CommandBarEditFlowArgs
}

const isEditingNode = (context: {
  argumentsToSubmit: Record<string, unknown>
}) => Boolean(context.argumentsToSubmit.nodeToEdit)

const isEditingNodeSelection = (context: {
  argumentsToSubmit: Record<string, unknown>
  selectedCommand?: { useModelingDialog?: boolean }
}) =>
  isEditingNode(context) && context.selectedCommand?.useModelingDialog !== true

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
  // TODO: {} means any non-nullish value. This is probably not what we want.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  'Delete selection': {}
} & WithCommandBarEditFlowArgs<StdLibModelingCommandSchema>

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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Extrude
    ),
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
              'sweepEdge',
              'primitiveEdge',
              'enginePrimitiveEdge',
              'cap',
              'wall',
              'pathRegion',
              'engineRegion',
            ],
            multiple: true,
            hidden: isEditingNodeSelection,
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
          direction: {
            inputType: 'selection',
            selectionTypes: [
              'segment',
              'sweepEdge',
              'primitiveEdge',
              'enginePrimitiveEdge',
            ],
            multiple: false,
            clearSelectionFirst: true,
          },
          method: {
            inputType: 'options',
            required: extrudeSelectionRequiresMethod,
            options: KCL_PRELUDE_EXTRUDE_METHOD_VALUES.map((value) => ({
              name: capitaliseFC(value.toLowerCase()),
              value,
            })),
          },
          bodyType: {
            inputType: 'options',
            required: extrudeSelectionRequiresBodyType,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Sweep
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Sweep']>('Sweep', {
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
          hidden: isEditingNodeSelection,
        },
        path: {
          inputType: 'selection',
          selectionTypes: ['segment', 'path', 'helix'],
          clearSelectionFirst: true,
          multiple: true,
          hidden: isEditingNodeSelection,
        },
        relativeTo: {
          inputType: 'options',
          options: [
            { name: 'Sketch Plane', value: 'SKETCH_PLANE' },
            { name: 'Trajectory Curve', value: 'TRAJECTORY' },
          ],
        },
        translateProfileToPath: {
          inputType: 'boolean',
          required: false,
        },
        orientProfilePerpendicular: {
          inputType: 'boolean',
          required: false,
        },
        bodyType: {
          inputType: 'options',
          required: profileSelectionRequiresBodyType,
          options: kclBodyTypeOptions,
        },
        version: {
          inputType: 'kcl',
          description:
            'Sweep algorithm version. 0 lets the engine choose; 1 is original; 2 is newer.',
          defaultValue: '2',
          required: false,
        },
      },
    }),
  },
  Loft: {
    description: 'Create a 3D body by blending between two or more sketches',
    icon: 'loft',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Loft
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Loft']>('Loft', {
      overrides: {
        sketches: {
          inputType: 'selection',
          displayName: 'Profiles',
          selectionTypes: ['solid2d', 'segment', 'pathRegion', 'engineRegion'],
          multiple: true,
          hidden: isEditingNodeSelection,
        },
        bodyType: {
          inputType: 'options',
          required: profileSelectionRequiresBodyType,
          options: kclBodyTypeOptions,
        },
      },
    }),
  },
  Revolve: {
    description: 'Create a 3D body by rotating a sketch region about an axis.',
    icon: 'revolve',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Revolve
    ),
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
            hidden: isEditingNodeSelection,
          },
          axisOrEdge: {
            inputType: 'options',
            required: true,
            defaultValue: 'Axis',
            options: [
              { name: 'Sketch Axis', isCurrent: true, value: 'Axis' },
              { name: 'Edge', isCurrent: false, value: 'Edge' },
            ],
            hidden: isEditingNodeSelection,
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
          },
          edge: {
            required: (context) =>
              ['Edge'].includes(context.argumentsToSubmit.axisOrEdge as string),
            inputType: 'selection',
            selectionTypes: ['segment'],
            multiple: false,
            hidden: (context) =>
              isEditingNode(context) ||
              !['Edge'].includes(
                context.argumentsToSubmit.axisOrEdge as string
              ),
          },
          angle: {
            defaultValue: KCL_DEFAULT_DEGREE,
            required: true,
          },
          bodyType: {
            inputType: 'options',
            required: profileSelectionRequiresBodyType,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Shell
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Shell']>('Shell', {
      overrides: {
        faces: {
          inputType: 'selection',
          selectionTypes: ['cap', 'wall'],
          multiple: true,
          hidden: isEditingNodeSelection,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Hole
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Hole']>('Hole', {
      overrides: {
        face: {
          inputType: 'selection',
          selectionTypes: ['cap', 'wall', 'edgeCut'],
          multiple: false,
          hidden: isEditingNodeSelection,
        },
        cutAt: {
          inputType: 'vector2d', // TODO: see if we can make the KCL arg Point2d
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['Boolean Subtract']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Boolean Subtract']>(
      'Boolean Subtract',
      {
        overrides: {
          solids: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            multiple: true,
            hidden: isEditingNodeSelection,
          },
          tools: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            clearSelectionFirst: true,
            multiple: true,
            hidden: isEditingNodeSelection,
          },
        },
      }
    ),
  },
  'Boolean Union': {
    description: 'Union multiple solids into a single solid.',
    icon: 'booleanUnion',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['Boolean Union']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Boolean Union']>(
      'Boolean Union',
      {
        overrides: {
          solids: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            multiple: true,
            skip: false,
            hidden: isEditingNodeSelection,
          },
        },
      }
    ),
  },
  'Boolean Intersect': {
    description: 'Create a solid from the intersection of two solids.',
    icon: 'booleanIntersect',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['Boolean Intersect']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Boolean Intersect']>(
      'Boolean Intersect',
      {
        overrides: {
          solids: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            multiple: true,
            skip: false,
            hidden: isEditingNodeSelection,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['Boolean Split']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Boolean Split']>(
      'Boolean Split',
      {
        overrides: {
          targets: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            multiple: true,
            hidden: isEditingNodeSelection,
          },
          tools: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            clearSelectionFirst: true,
            multiple: true,
            hidden: isEditingNodeSelection,
          },
        },
      }
    ),
  },
  'Offset plane': {
    description: 'Offset a plane.',
    icon: 'plane',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['Offset plane']
    ),
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
            hidden: isEditingNodeSelection,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Helix
    ),
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
          hidden: isEditingNodeSelection,
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
          selectionTypes: ['segment'],
          multiple: false,
          required: (context) =>
            ['Edge'].includes(context.argumentsToSubmit.mode as string),
          hidden: (context) =>
            isEditingNode(context) ||
            !['Edge'].includes(context.argumentsToSubmit.mode as string),
        },
        cylinder: {
          ...objectsTypesAndFilters,
          inputType: 'selection',
          multiple: false,
          required: (context) =>
            ['Cylinder'].includes(context.argumentsToSubmit.mode as string),
          hidden: (context) =>
            isEditingNode(context) ||
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['Helical Gear']
    ),
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['Herringbone Gear']
    ),
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['Spur Gear']
    ),
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['Ring Gear']
    ),
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Fillet
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Fillet']>('Fillet', {
      overrides: {
        selection: {
          inputType: 'selection',
          selectionTypes: ['segment', 'primitiveEdge', 'enginePrimitiveEdge'],
          multiple: true,
          required: true,
          skip: false,
          hidden: isEditingNodeSelection,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Chamfer
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Chamfer']>(
      'Chamfer',
      {
        overrides: {
          selection: {
            inputType: 'selection',
            selectionTypes: ['segment', 'primitiveEdge', 'enginePrimitiveEdge'],
            multiple: true,
            required: true,
            skip: false,
            hidden: isEditingNodeSelection,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Appearance
    ),
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
            hidden: isEditingNodeSelection,
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
    status: modelingStdLibCommandStatus('Delete'),
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Delete
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Delete']>('Delete', {
      overrides: {
        objects: {
          ...objectsTypesAndFilters,
          inputType: 'selectionMixed',
          multiple: true,
        },
      },
    }),
  },
  Translate: {
    description: 'Set translation on solid or sketch.',
    icon: 'move',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Translate
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Translate']>(
      'Translate',
      {
        overrides: {
          objects: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            multiple: true,
            hidden: isEditingNodeSelection,
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
          xyz: {
            inputType: 'vector3d',
            defaultValue: KCL_DEFAULT_ORIGIN,
          },
        },
      }
    ),
  },
  Rotate: {
    description: 'Set rotation on solid or sketch.',
    icon: 'rotate',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Rotate
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Rotate']>('Rotate', {
      overrides: {
        objects: {
          ...objectsTypesAndFilters,
          inputType: 'selectionMixed',
          multiple: true,
          hidden: isEditingNodeSelection,
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
        axis: {
          inputType: 'options',
          defaultValue: KCL_AXIS_Z,
          options: [
            { name: 'X-axis', value: KCL_AXIS_X },
            { name: 'Y-axis', value: KCL_AXIS_Y },
            { name: 'Z-axis', isCurrent: true, value: KCL_AXIS_Z },
          ],
        },
        angle: {
          defaultValue: KCL_DEFAULT_DEGREE,
        },
      },
    }),
  },
  Scale: {
    description: 'Set scale on solid or sketch.',
    icon: 'scale',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Scale
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Scale']>('Scale', {
      overrides: {
        objects: {
          ...objectsTypesAndFilters,
          inputType: 'selectionMixed',
          multiple: true,
          hidden: isEditingNodeSelection,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Clone
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Clone']>('Clone', {
      overrides: {
        objects: {
          ...objectsTypesAndFilters,
          inputType: 'selectionMixed',
          multiple: false, // only one object can be cloned at this time
          hidden: isEditingNodeSelection,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['Mirror 3D']
    ),
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['Pattern Circular 3D']
    ),
    args: modelingStdLibCommandArgs<
      ModelingCommandSchema['Pattern Circular 3D']
    >('Pattern Circular 3D', {
      overrides: {
        solids: {
          ...objectsTypesAndFilters,
          inputType: 'selectionMixed',
          multiple: true,
          hidden: isEditingNodeSelection,
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
          required: true, // TODO: not true in KCL, we should fix the e2e test to match
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['Pattern Linear 3D']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Pattern Linear 3D']>(
      'Pattern Linear 3D',
      {
        overrides: {
          solids: {
            ...objectsTypesAndFilters,
            inputType: 'selectionMixed',
            multiple: true,
            hidden: isEditingNodeSelection,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['GDT Flatness']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Flatness']>(
      'GDT Flatness',
      {
        overrides: {
          faces: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut'],
            multiple: true,
            hidden: isEditingNodeSelection,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['GDT Straightness']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Straightness']>(
      'GDT Straightness',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment'],
            multiple: true,
            required: true,
            hidden: isEditingNodeSelection,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['GDT Circularity']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Circularity']>(
      'GDT Circularity',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment'],
            multiple: true,
            required: true,
            hidden: isEditingNodeSelection,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['GDT Cylindricity']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Cylindricity']>(
      'GDT Cylindricity',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment'],
            multiple: true,
            required: true,
            hidden: isEditingNodeSelection,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['GDT Datum']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Datum']>(
      'GDT Datum',
      {
        overrides: {
          faces: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut'],
            multiple: false,
            hidden: isEditingNodeSelection,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['GDT Position']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Position']>(
      'GDT Position',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment'],
            multiple: true,
            required: true,
            hidden: isEditingNodeSelection,
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
      'Add profile geometric dimensioning & tolerancing annotation to faces or edges.',
    icon: 'gdtProfile',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['GDT Profile']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Profile']>(
      'GDT Profile',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment'],
            multiple: true,
            required: true,
            hidden: isEditingNodeSelection,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['GDT Distance']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Distance']>(
      'GDT Distance',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment'],
            multiple: true,
            required: true,
            hidden: isEditingNodeSelection,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['GDT Perpendicularity']
    ),
    args: modelingStdLibCommandArgs<
      ModelingCommandSchema['GDT Perpendicularity']
    >('GDT Perpendicularity', {
      overrides: {
        objects: {
          inputType: 'selection',
          selectionTypes: ['cap', 'wall', 'edgeCut', 'segment'],
          multiple: true,
          required: true,
          hidden: isEditingNodeSelection,
        },
        datums: datumsProps,
        tolerance: gdtToleranceProps,
        ...gdtFrameArgOverrides,
      },
    }),
  },
  'GDT Angularity': {
    description:
      'Add angularity geometric dimensioning & tolerancing annotation to faces and edges.',
    icon: 'angle',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['GDT Angularity']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Angularity']>(
      'GDT Angularity',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment'],
            multiple: true,
            required: true,
            hidden: isEditingNodeSelection,
          },
          datums: datumsProps,
          tolerance: gdtToleranceProps,
          ...gdtFrameArgOverrides,
        },
      }
    ),
  },
  'GDT Concentricity': {
    description:
      'Add concentricity geometric dimensioning & tolerancing annotation to faces and edges.',
    icon: 'gdtConcentricity',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['GDT Concentricity']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Concentricity']>(
      'GDT Concentricity',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment'],
            multiple: true,
            required: true,
            hidden: isEditingNodeSelection,
          },
          datums: {
            ...datumsProps,
            required: true,
          },
          tolerance: gdtToleranceProps,
          ...gdtFrameArgOverrides,
        },
      }
    ),
  },
  'GDT Symmetry': {
    description:
      'Add symmetry geometric dimensioning & tolerancing annotation to faces and edges.',
    icon: 'gdtSymmetry',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['GDT Symmetry']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Symmetry']>(
      'GDT Symmetry',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment'],
            multiple: true,
            required: true,
            hidden: isEditingNodeSelection,
          },
          datums: {
            ...datumsProps,
            required: true,
          },
          tolerance: gdtToleranceProps,
          ...gdtFrameArgOverrides,
        },
      }
    ),
  },
  'GDT Runout': {
    description:
      'Add runout geometric dimensioning & tolerancing annotation to faces and edges.',
    icon: 'gdtRunout',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['GDT Runout']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Runout']>(
      'GDT Runout',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment'],
            multiple: true,
            required: true,
            hidden: isEditingNodeSelection,
          },
          datums: {
            ...datumsProps,
            required: true,
          },
          tolerance: gdtToleranceProps,
          ...gdtFrameArgOverrides,
        },
      }
    ),
  },
  'GDT Parallelism': {
    description:
      'Add parallelism geometric dimensioning & tolerancing annotation to faces and edges.',
    icon: 'parallel',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['GDT Parallelism']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Parallelism']>(
      'GDT Parallelism',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment'],
            multiple: true,
            required: true,
            hidden: isEditingNodeSelection,
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['GDT Annotation']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Annotation']>(
      'GDT Annotation',
      {
        overrides: {
          objects: {
            inputType: 'selection',
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment'],
            multiple: true,
            required: true,
            hidden: isEditingNodeSelection,
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
  'GDT Note': {
    description: 'Add a free-floating model-based definition note on a plane.',
    icon: 'note',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['GDT Note']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['GDT Note']>(
      'GDT Note',
      {
        overrides: {
          note: {
            inputType: 'text',
            defaultValue: 'Note:',
          },
          framePosition: gdtFrameDisplayArgOverrides.framePosition,
          framePlane: gdtFrameDisplayArgOverrides.framePlane,
          fontSize: gdtFrameDisplayArgOverrides.fontSize,
        },
      }
    ),
  },
  'Flip Surface': {
    description:
      'Flips the orientation of a surface, swapping which side is the front and which is the reverse.',
    icon: 'flipSurface',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['Flip Surface']
    ),
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['Join Surfaces']
    ),
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods['Delete Face']
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Delete Face']>(
      'Delete Face',
      {
        overrides: {
          faces: {
            inputType: 'selection',
            selectionTypes: [
              'cap',
              'wall',
              'edgeCut',
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
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Blend
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Blend']>('Blend', {
      overrides: {
        edges: {
          inputType: 'selection',
          selectionTypes: ['segment', 'primitiveEdge', 'enginePrimitiveEdge'],
          multiple: true,
          description: 'Only straight edges are supported now.',
        },
      },
    }),
  },
}

// TODO: update modelingMachineCommandConfig with satisfies?
