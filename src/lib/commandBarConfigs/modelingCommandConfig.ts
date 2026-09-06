import type {
  AxisDirectionPair,
  EntityType,
  OutputFormat3d,
  UnitLength,
} from '@kittycad/lib'

import { angleLengthInfo } from '@src/components/Toolbar/angleLengthInfo'
import { findUniqueName } from '@src/lang/create'
import { getNextAvailableDatumName } from '@src/lang/modifyAst/gdt'
import { createModelingCodemodReviewValidation } from '@src/lang/modifyAst/modelingCodemod'
import { transformAstSketchLines } from '@src/lang/std/sketchcombos'
import type { Artifact, PathToNode } from '@src/lang/wasm'
import { modelingCommandCodemods } from '@src/lib/commandBarConfigs/modelingCommandCodemods'
import {
  modelingStdLibCommandArgs,
  modelingStdLibCommandStatus,
  modelingStdLibCommandSummary,
} from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { StdLibModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import {
  isEditingNode,
  isEditingNodeSelection,
  isUsingModelingDialog,
  type ModelingDialogContext,
} from '@src/lib/commandBarConfigs/modelingDialogShared'
import {
  chamferDialogLayout,
  chamferDialogOverrides,
} from '@src/lib/commandBarConfigs/modelingDialogs/chamfer'
import {
  extrudeDialogLayout,
  extrudeDialogOverrides,
} from '@src/lib/commandBarConfigs/modelingDialogs/extrude'
import {
  holeDialogLayout,
  holeDialogOverrides,
} from '@src/lib/commandBarConfigs/modelingDialogs/hole'
import {
  loftDialogLayout,
  loftDialogOverrides,
} from '@src/lib/commandBarConfigs/modelingDialogs/loft'
import {
  revolveDialogLayout,
  revolveDialogOverrides,
} from '@src/lib/commandBarConfigs/modelingDialogs/revolve'
import {
  sweepDialogLayout,
  sweepDialogOverrides,
} from '@src/lib/commandBarConfigs/modelingDialogs/sweep'
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
  KCL_DEFAULT_ROTATE_ANGLE,
  KCL_DEFAULT_SCALE,
  KCL_DEFAULT_SCALE_FACTOR,
  KCL_DEFAULT_TOLERANCE,
  KCL_DEFAULT_TRANSLATE_X,
  KCL_DEFAULT_TRANSFORM,
  KCL_PLANE_XY,
  KCL_PLANE_XZ,
  KCL_PLANE_YZ,
} from '@src/lib/constants'
import type { components } from '@src/lib/machine-api'
import { baseUnitLabels, baseUnitsUnion } from '@src/lib/settings/settingsTypes'
import { err } from '@src/lib/trap'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type {
  ModelingMachineContext,
  Selections,
  SketchTool,
} from '@src/machines/modelingSharedTypes'
import { MODE_SKETCHING_COMMAND_SCOPE } from '@src/registry/contracts/commands'

export type { HelixModes } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
export { profileSelectionRequiresBodyType } from '@src/lib/commandBarConfigs/modelingDialogShared'
export {
  extrudeSelectionRequiresBodyType,
  extrudeSelectionRequiresMethod,
} from '@src/lib/commandBarConfigs/modelingDialogs/extrude'

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
  if (typeof exportType !== 'string') {
    return true
  }
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

// Edit flows pass this as hidden command-bar metadata, not as a KCL stdlib arg.
type CommandBarEditFlowArgs = {
  nodeToEdit?: PathToNode
}

type WithCommandBarEditFlowArgs<Schema> = {
  [CommandName in keyof Schema]: Schema[CommandName] & CommandBarEditFlowArgs
}

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
      scopes: [MODE_SKETCHING_COMMAND_SCOPE],
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
      scopes: [MODE_SKETCHING_COMMAND_SCOPE],
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
      scopes: [MODE_SKETCHING_COMMAND_SCOPE],
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
                  } #${machine.hardware_configuration.config?.filaments[0].color?.slice(
                    0,
                    6
                  )}`
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
    description: modelingStdLibCommandSummary('Extrude'),
    icon: 'extrude',
    needsReview: true,
    dialogLayout: extrudeDialogLayout,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Extrude
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Extrude']>(
      'Extrude',
      {
        overrides: extrudeDialogOverrides,
      }
    ),
  },
  Sweep: {
    description: modelingStdLibCommandSummary('Sweep'),
    icon: 'sweep',
    needsReview: true,
    dialogLayout: sweepDialogLayout,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Sweep
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Sweep']>('Sweep', {
      overrides: sweepDialogOverrides,
    }),
  },
  Loft: {
    description: modelingStdLibCommandSummary('Loft'),
    icon: 'loft',
    needsReview: true,
    dialogLayout: loftDialogLayout,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Loft
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Loft']>('Loft', {
      overrides: loftDialogOverrides,
    }),
  },
  Revolve: {
    description: modelingStdLibCommandSummary('Revolve'),
    icon: 'revolve',
    needsReview: true,
    dialogLayout: revolveDialogLayout,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Revolve
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Revolve']>(
      'Revolve',
      {
        overrides: revolveDialogOverrides,
      }
    ),
  },
  Shell: {
    description: modelingStdLibCommandSummary('Shell'),
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
    description: modelingStdLibCommandSummary('Hole'),
    icon: 'hole',
    needsReview: true,
    dialogLayout: holeDialogLayout,
    reviewMessage:
      'The argument cutAt specifies where to place the hole given as absolute coordinates in the global scene. Point selection will be allowed in the future, and more hole bottoms and hole types are coming soon.',
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Hole
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Hole']>('Hole', {
      overrides: holeDialogOverrides,
    }),
  },
  'Boolean Subtract': {
    description: modelingStdLibCommandSummary('Boolean Subtract'),
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
    description: modelingStdLibCommandSummary('Boolean Union'),
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
    description: modelingStdLibCommandSummary('Boolean Intersect'),
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
    description: modelingStdLibCommandSummary('Boolean Split'),
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
    description: modelingStdLibCommandSummary('Offset plane'),
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
    description: modelingStdLibCommandSummary('Helix'),
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
          selectionTypes: ['segment', 'sweepEdge'],
          multiple: false,
          required: (context) =>
            ['Edge'].includes(context.argumentsToSubmit.mode as string),
          hidden: (context) =>
            isEditingNode(context) ||
            !['Edge'].includes(context.argumentsToSubmit.mode as string),
        },
        cylinder: {
          ...objectsTypesAndFilters,
          selectionTypes: [
            ...objectsTypesAndFilters.selectionTypes,
            'pathRegion',
          ],
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
    description: modelingStdLibCommandSummary('Helical Gear'),
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
    description: modelingStdLibCommandSummary('Herringbone Gear'),
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
    description: modelingStdLibCommandSummary('Spur Gear'),
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
    description: modelingStdLibCommandSummary('Ring Gear'),
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
    description: modelingStdLibCommandSummary('Fillet'),
    icon: 'fillet3d',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Fillet
    ),
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
    description: modelingStdLibCommandSummary('Chamfer'),
    icon: 'chamfer3d',
    needsReview: true,
    dialogLayout: chamferDialogLayout,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Chamfer
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Chamfer']>(
      'Chamfer',
      {
        overrides: chamferDialogOverrides,
      }
    ),
  },
  'Constrain length': {
    scopes: [MODE_SKETCHING_COMMAND_SCOPE],
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
          if (!selectionRanges || !wasmInstance) {
            return KCL_DEFAULT_LENGTH
          }
          const angleLength = angleLengthInfo({
            selectionRanges,
            angleOrLength: 'setLength',
            kclManager: machineContext.kclManager,
            wasmInstance,
          })
          if (err(angleLength) || !wasmInstance) {
            return KCL_DEFAULT_LENGTH
          }
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
          if (err(sketched)) {
            return KCL_DEFAULT_LENGTH
          }
          const { valueUsedInTransform } = sketched
          return valueUsedInTransform?.toString() || KCL_DEFAULT_LENGTH
        },
      },
    },
  },
  'Constrain with named value': {
    scopes: [MODE_SKETCHING_COMMAND_SCOPE],
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
    description: modelingStdLibCommandSummary('Appearance'),
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
            defaultValue: (context: ModelingDialogContext) =>
              isUsingModelingDialog(context) ? '#ffffff' : '',
          },
        },
      }
    ),
  },
  Delete: {
    description: modelingStdLibCommandSummary('Delete'),
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
    description: modelingStdLibCommandSummary('Translate'),
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
            selectionTypes: [...objectsTypesAndFilters.selectionTypes, 'helix'],
            inputType: 'selectionMixed',
            multiple: true,
            hidden: isEditingNodeSelection,
          },
          x: {
            defaultValue: KCL_DEFAULT_TRANSLATE_X,
            prepopulate: true,
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
    description: modelingStdLibCommandSummary('Rotate'),
    icon: 'rotate',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Rotate
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Rotate']>('Rotate', {
      overrides: {
        objects: {
          ...objectsTypesAndFilters,
          selectionTypes: [...objectsTypesAndFilters.selectionTypes, 'helix'],
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
          prepopulate: true,
          options: [
            { name: 'X-axis', value: KCL_AXIS_X },
            { name: 'Y-axis', value: KCL_AXIS_Y },
            { name: 'Z-axis', isCurrent: true, value: KCL_AXIS_Z },
          ],
        },
        angle: {
          defaultValue: KCL_DEFAULT_ROTATE_ANGLE,
          prepopulate: true,
        },
      },
    }),
  },
  Scale: {
    description: modelingStdLibCommandSummary('Scale'),
    icon: 'scale',
    needsReview: true,
    reviewValidation: createModelingCodemodReviewValidation(
      modelingCommandCodemods.Scale
    ),
    args: modelingStdLibCommandArgs<ModelingCommandSchema['Scale']>('Scale', {
      overrides: {
        objects: {
          ...objectsTypesAndFilters,
          selectionTypes: [...objectsTypesAndFilters.selectionTypes, 'helix'],
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
          defaultValue: KCL_DEFAULT_SCALE_FACTOR,
          prepopulate: true,
        },
      },
    }),
  },
  Clone: {
    description: modelingStdLibCommandSummary('Clone'),
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
              modelingContext.kclManager.variables[`__mod_${data}`]
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
    description: modelingStdLibCommandSummary('Mirror 3D'),
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
    description: modelingStdLibCommandSummary('Pattern Circular 3D'),
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
    description: modelingStdLibCommandSummary('Pattern Linear 3D'),
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
    description: modelingStdLibCommandSummary('GDT Flatness'),
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
    description: modelingStdLibCommandSummary('GDT Straightness'),
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
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
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
    description: modelingStdLibCommandSummary('GDT Circularity'),
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
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
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
    description: modelingStdLibCommandSummary('GDT Cylindricity'),
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
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
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
    description: modelingStdLibCommandSummary('GDT Datum'),
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
    description: modelingStdLibCommandSummary('GDT Position'),
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
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
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
    description: modelingStdLibCommandSummary('GDT Profile'),
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
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
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
    description: modelingStdLibCommandSummary('GDT Distance'),
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
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
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
    description: modelingStdLibCommandSummary('GDT Perpendicularity'),
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
          selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
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
    description: modelingStdLibCommandSummary('GDT Angularity'),
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
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
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
    description: modelingStdLibCommandSummary('GDT Concentricity'),
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
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
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
    description: modelingStdLibCommandSummary('GDT Symmetry'),
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
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
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
    description: modelingStdLibCommandSummary('GDT Runout'),
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
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
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
    description: modelingStdLibCommandSummary('GDT Parallelism'),
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
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
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
    description: modelingStdLibCommandSummary('GDT Annotation'),
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
            selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
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
    description: modelingStdLibCommandSummary('GDT Note'),
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
    description: modelingStdLibCommandSummary('Flip Surface'),
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
    description: modelingStdLibCommandSummary('Join Surfaces'),
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
    description: modelingStdLibCommandSummary('Delete Face'),
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
    description: modelingStdLibCommandSummary('Blend'),
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
