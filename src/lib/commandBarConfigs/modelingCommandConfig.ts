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
  type KclPreludeBodyType,
  type KclPreludeExtrudeMethod,
} from '@src/lib/constants'
import type { components } from '@src/lib/machine-api'
import {
  getEngineTopologyFallbackNormalized,
  mergeEngineTopologyFallbackFromLiveSelection,
} from '@src/lib/selections'
import { baseUnitLabels, baseUnitsUnion } from '@src/lib/settings/settingsTypes'
import { err } from '@src/lib/trap'
import type { modelingMachine } from '@src/machines/modelingMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type {
  ModelingMachineContext,
  SketchTool,
} from '@src/machines/modelingSharedTypes'

const FRAME_PLANE_OPTIONS = [
  { name: 'XY Plane', value: KCL_PLANE_XY, isCurrent: true },
  { name: 'XZ Plane', value: KCL_PLANE_XZ },
  { name: 'YZ Plane', value: KCL_PLANE_YZ },
]

import { mockExecAstAndReportErrors } from '@src/lang/modelingWorkflows'
import {
  addIntersect,
  addSplit,
  addSubtract,
  addUnion,
} from '@src/lang/modifyAst/boolean'
import { addBlend, addChamfer, addFillet } from '@src/lang/modifyAst/edges'
import type { HoleBody, HoleBottom, HoleType } from '@src/lang/modifyAst/faces'
import {
  addDeleteFace,
  addHole,
  addOffsetPlane,
  addShell,
} from '@src/lang/modifyAst/faces'
import {
  addAngularityGdt,
  addAnnotationGdt,
  addCircularityGdt,
  addConcentricityGdt,
  addCylindricityGdt,
  addDatumGdt,
  addDistanceGdt,
  addFlatnessGdt,
  addNoteGdt,
  addParallelismGdt,
  addPerpendicularityGdt,
  addPositionGdt,
  addProfileGdt,
  addRunoutGdt,
  addStraightnessGdt,
  addSymmetryGdt,
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
import { addFlipSurface, addJoinSurfaces } from '@src/lang/modifyAst/surfaces'
import {
  type SweepRelativeTo,
  addExtrude,
  addLoft,
  addRevolve,
  addSweep,
} from '@src/lang/modifyAst/sweeps'
import {
  addAppearance,
  addClone,
  addMirror3D,
  addRotate,
  addScale,
  addTranslate,
} from '@src/lang/modifyAst/transforms'
import { capitaliseFC, isArray } from '@src/lib/utils'
import type { ConnectionManager } from '@src/network/connectionManager'

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

function isKclCommandValue(value: unknown): value is KclCommandValue {
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
  if (
    typeof sketches !== 'object' ||
    sketches === null ||
    !('graphSelections' in sketches) ||
    !isArray(sketches.graphSelections)
  ) {
    return false
  }

  return sketches.graphSelections.some(
    (selection) =>
      typeof selection === 'object' &&
      selection !== null &&
      (!('artifact' in selection) ||
        !selection.artifact ||
        (typeof selection.artifact === 'object' &&
          'type' in selection.artifact &&
          selection.artifact.type === 'segment'))
  )
}

export function extrudeSelectionRequiresBodyType(context: {
  argumentsToSubmit: Record<string, unknown>
}): boolean {
  if (!isKclCommandValue(context.argumentsToSubmit.length)) {
    return false
  }

  return profileSelectionRequiresBodyType(context)
}

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
    up?: AxisDirectionPair['axis']
    scale?: UnitLength
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
    draftAngle?: KclCommandValue
    twistAngle?: KclCommandValue
    twistAngleStep?: KclCommandValue
    twistCenter?: KclCommandValue
    // TODO: figure out if we should expose `tolerance` or not
    // @pierremtb: I don't even think it should be in KCL
    method?: KclPreludeExtrudeMethod
    hideSeams?: boolean
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
    translateProfileToPath?: boolean
    orientProfilePerpendicular?: boolean
    tagStart?: string
    tagEnd?: string
    bodyType?: KclPreludeBodyType
    version?: KclCommandValue
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
    // KCL stdlib arguments, with solids inferred from faces here
    faces: Selections
    thickness: KclCommandValue
  }
  Hole: {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // KCL stdlib arguments, with solids inferred from faces here
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
    countersinkHeadClearance?: KclCommandValue
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
  'Helical Gear': {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // KCL gear::helical arguments
    nTeeth: KclCommandValue
    module: KclCommandValue
    pressureAngle: KclCommandValue
    helixAngle: KclCommandValue
    gearHeight: KclCommandValue
  }
  'Herringbone Gear': {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // KCL gear::herringbone arguments
    nTeeth: KclCommandValue
    module: KclCommandValue
    pressureAngle: KclCommandValue
    gearHeight: KclCommandValue
    helixAngle: KclCommandValue
  }
  'Spur Gear': {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // KCL gear::spur arguments
    nTeeth: KclCommandValue
    module: KclCommandValue
    pressureAngle: KclCommandValue
    gearHeight: KclCommandValue
  }
  'Ring Gear': {
    // Enables editing workflow
    nodeToEdit?: PathToNode
    // KCL gear::ring arguments
    nTeeth: KclCommandValue
    module: KclCommandValue
    pressureAngle: KclCommandValue
    helixAngle: KclCommandValue
    gearHeight: KclCommandValue
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
    opacity?: KclCommandValue
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
  'Mirror 3D': {
    nodeToEdit?: PathToNode
    bodies: Selections
    across: Selections
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
    leaderScale?: KclCommandValue
    fontSize?: KclCommandValue
  }
  'GDT Straightness': {
    nodeToEdit?: PathToNode
    objects: Selections
    tolerance: KclCommandValue
    precision?: KclCommandValue
    framePosition?: KclCommandValue
    framePlane?: string
    leaderScale?: KclCommandValue
    fontSize?: KclCommandValue
  }
  'GDT Circularity': {
    nodeToEdit?: PathToNode
    objects: Selections
    tolerance: KclCommandValue
    precision?: KclCommandValue
    framePosition?: KclCommandValue
    framePlane?: string
    leaderScale?: KclCommandValue
    fontSize?: KclCommandValue
  }
  'GDT Cylindricity': {
    nodeToEdit?: PathToNode
    objects: Selections
    tolerance: KclCommandValue
    precision?: KclCommandValue
    framePosition?: KclCommandValue
    framePlane?: string
    leaderScale?: KclCommandValue
    fontSize?: KclCommandValue
  }
  'GDT Position': {
    nodeToEdit?: PathToNode
    objects: Selections
    datums?: KclCommandValue
    tolerance: KclCommandValue
    precision?: KclCommandValue
    framePosition?: KclCommandValue
    framePlane?: string
    leaderScale?: KclCommandValue
    fontSize?: KclCommandValue
  }
  'GDT Profile': {
    nodeToEdit?: PathToNode
    edges: Selections
    profileFunction?: 'profile' | 'profileLine' | 'profileSurface'
    datums?: KclCommandValue
    tolerance: KclCommandValue
    precision?: KclCommandValue
    framePosition?: KclCommandValue
    framePlane?: string
    leaderScale?: KclCommandValue
    fontSize?: KclCommandValue
  }
  'GDT Distance': {
    nodeToEdit?: PathToNode
    objects: Selections
    tolerance: KclCommandValue
    precision?: KclCommandValue
    framePosition?: KclCommandValue
    framePlane?: string
    leaderScale?: KclCommandValue
    fontSize?: KclCommandValue
  }
  'GDT Perpendicularity': {
    nodeToEdit?: PathToNode
    objects: Selections
    datums?: KclCommandValue
    tolerance: KclCommandValue
    precision?: KclCommandValue
    framePosition?: KclCommandValue
    framePlane?: string
    leaderScale?: KclCommandValue
    fontSize?: KclCommandValue
  }
  'GDT Angularity': {
    nodeToEdit?: PathToNode
    objects: Selections
    datums?: KclCommandValue
    tolerance: KclCommandValue
    precision?: KclCommandValue
    framePosition?: KclCommandValue
    framePlane?: string
    leaderScale?: KclCommandValue
    fontSize?: KclCommandValue
  }
  'GDT Concentricity': {
    nodeToEdit?: PathToNode
    objects: Selections
    datums: KclCommandValue
    tolerance: KclCommandValue
    precision?: KclCommandValue
    framePosition?: KclCommandValue
    framePlane?: string
    leaderScale?: KclCommandValue
    fontSize?: KclCommandValue
  }
  'GDT Symmetry': {
    nodeToEdit?: PathToNode
    objects: Selections
    datums: KclCommandValue
    tolerance: KclCommandValue
    precision?: KclCommandValue
    framePosition?: KclCommandValue
    framePlane?: string
    leaderScale?: KclCommandValue
    fontSize?: KclCommandValue
  }
  'GDT Runout': {
    nodeToEdit?: PathToNode
    objects: Selections
    datums: KclCommandValue
    tolerance: KclCommandValue
    precision?: KclCommandValue
    framePosition?: KclCommandValue
    framePlane?: string
    leaderScale?: KclCommandValue
    fontSize?: KclCommandValue
  }
  'GDT Parallelism': {
    nodeToEdit?: PathToNode
    objects: Selections
    datums?: KclCommandValue
    tolerance: KclCommandValue
    precision?: KclCommandValue
    framePosition?: KclCommandValue
    framePlane?: string
    leaderScale?: KclCommandValue
    fontSize?: KclCommandValue
  }
  'GDT Annotation': {
    nodeToEdit?: PathToNode
    objects: Selections
    annotation: string
    framePosition?: KclCommandValue
    framePlane?: string
    leaderScale?: KclCommandValue
    fontSize?: KclCommandValue
  }
  'GDT Note': {
    nodeToEdit?: PathToNode
    note: string
    framePosition?: KclCommandValue
    framePlane?: string
    fontSize?: KclCommandValue
  }
  'GDT Datum': {
    nodeToEdit?: PathToNode
    faces: Selections
    name: string
    framePosition?: KclCommandValue
    framePlane?: string
    leaderScale?: KclCommandValue
    fontSize?: KclCommandValue
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
  'Flip Surface': {
    surface: Selections
  }
  'Delete Face': {
    faces: Selections
  }
  'Boolean Split': {
    nodeToEdit?: PathToNode
    targets: Selections
    tools?: Selections
    merge?: boolean
    keepTools?: boolean
  }
  Blend: {
    edges: Selections
  }
  'Join Surfaces': {
    selection: Selections
  }
}

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

const summarizeDatumKclValue = (value?: KclCommandValue) =>
  value
    ? kclDatumArrayToInput(
        value.valueCalculated === 'NAN'
          ? value.valueText
          : value.valueCalculated
      )
    : ''

const createGdtDatumsArg = (required: boolean) =>
  ({
    inputType: 'kcl',
    defaultValue: KCL_DEFAULT_DATUM_REFS,
    allowArrays: true,
    allowStringArrays: true,
    allowUncalculated: true,
    inputToKclValue: datumInputToKclArray,
    kclValueToInput: kclDatumArrayToInput,
    valueSummary: summarizeDatumKclValue,
    required,
  }) satisfies CommandArgumentConfig<KclCommandValue, ModelingMachineContext>

const gdtToleranceValueSummary = (value?: KclCommandValue) =>
  value?.valueText ?? ''

export const getDefaultGdtTolerance = (
  _commandBarContext: unknown,
  modelingContext?: ModelingMachineContext
) => {
  const defaultLengthUnit =
    modelingContext?.kclManager.fileSettings.defaultLengthUnit ||
    DEFAULT_DEFAULT_LENGTH_UNIT
  return `${KCL_DEFAULT_TOLERANCE}${defaultLengthUnit}`
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
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
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
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
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
        description: 'Only parallel faces are supported for now.',
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
      hideSeams: {
        inputType: 'boolean',
        required: false,
      },
      bodyType: {
        inputType: 'options',
        required: extrudeSelectionRequiresBodyType,
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
        selectionTypes: [
          'solid2d',
          'segment',
          'cap',
          'wall',
          'pathRegion',
          'engineRegion',
        ],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      path: {
        inputType: 'selection',
        selectionTypes: ['segment', 'path', 'helix'],
        clearSelectionFirst: true,
        required: true,
        multiple: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
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
      translateProfileToPath: {
        inputType: 'boolean',
        required: false,
      },
      orientProfilePerpendicular: {
        inputType: 'boolean',
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
        required: profileSelectionRequiresBodyType,
        options: kclBodyTypeOptions,
      },
      version: {
        inputType: 'kcl',
        description:
          'Sweep algorithm version. 0 lets the engine choose; 1 is original; 2 is newer.',
        defaultValue: '2',
        required: false,
        status: 'experimental',
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
        selectionTypes: ['solid2d', 'segment', 'pathRegion', 'engineRegion'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
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
        required: profileSelectionRequiresBodyType,
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
        selectionTypes: ['solid2d', 'segment', 'pathRegion', 'engineRegion'],
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
        selectionTypes: ['segment', 'primitiveEdge', 'edgeCut'],
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
        required: profileSelectionRequiresBodyType,
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
        selectionTypes: ['cap', 'wall', 'primitiveFace', 'enginePrimitiveFace'],
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
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
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
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      tools: {
        ...objectsTypesAndFilters,
        inputType: 'selectionMixed',
        clearSelectionFirst: true,
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
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
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
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
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
    },
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
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      targets: {
        ...objectsTypesAndFilters,
        inputType: 'selectionMixed',
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      tools: {
        ...objectsTypesAndFilters,
        inputType: 'selectionMixed',
        clearSelectionFirst: true,
        multiple: true,
        required: false,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      merge: {
        inputType: 'boolean',
        required: false,
      },
      keepTools: {
        inputType: 'boolean',
        required: false,
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
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
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
      const wasmInstance = await context.wasmInstancePromise
      const modRes = addHelix({
        ...(context.argumentsToSubmit as ModelingCommandSchema['Helix']),
        ast: kclManager.ast,
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
        selectionTypes: ['segment', 'primitiveEdge', 'edgeCut'],
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
  'Helical Gear': {
    description: 'Create a helical gear.',
    icon: 'gear',
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
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      nTeeth: {
        inputType: 'kcl',
        required: true,
        defaultValue: '10',
      },
      module: {
        inputType: 'kcl',
        required: true,
        defaultValue: '2',
      },
      pressureAngle: {
        inputType: 'kcl',
        required: true,
        defaultValue: '20deg',
      },
      helixAngle: {
        inputType: 'kcl',
        required: true,
        defaultValue: '35deg',
      },
      gearHeight: {
        inputType: 'kcl',
        required: true,
        defaultValue: '7',
      },
    },
  },
  'Herringbone Gear': {
    description: 'Create a herringbone gear.',
    icon: 'gear',
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
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      nTeeth: {
        inputType: 'kcl',
        required: true,
        defaultValue: '10',
      },
      module: {
        inputType: 'kcl',
        required: true,
        defaultValue: '2',
      },
      pressureAngle: {
        inputType: 'kcl',
        required: true,
        defaultValue: '20deg',
      },
      gearHeight: {
        inputType: 'kcl',
        required: true,
        defaultValue: '5',
      },
      helixAngle: {
        inputType: 'kcl',
        required: true,
        defaultValue: '40deg',
      },
    },
  },
  'Spur Gear': {
    description: 'Create a spur gear.',
    icon: 'gear',
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
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      nTeeth: {
        inputType: 'kcl',
        required: true,
        defaultValue: '21',
      },
      module: {
        inputType: 'kcl',
        required: true,
        defaultValue: '1.5',
      },
      pressureAngle: {
        inputType: 'kcl',
        required: true,
        defaultValue: '14deg',
      },
      gearHeight: {
        inputType: 'kcl',
        required: true,
        defaultValue: '6',
      },
    },
  },
  'Ring Gear': {
    description: 'Create a ring gear.',
    icon: 'gear',
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
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      nTeeth: {
        inputType: 'kcl',
        required: true,
        defaultValue: '40',
      },
      module: {
        inputType: 'kcl',
        required: true,
        defaultValue: '1.5',
      },
      pressureAngle: {
        inputType: 'kcl',
        required: true,
        defaultValue: '14deg',
      },
      helixAngle: {
        inputType: 'kcl',
        required: true,
        defaultValue: '-25deg',
      },
      gearHeight: {
        inputType: 'kcl',
        required: true,
        defaultValue: '5',
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
      // Set localStorage DEBUG_FILLET_SELECTION=1 to compare command-bar selection vs live modeling selection.
      if (
        typeof localStorage !== 'undefined' &&
        localStorage.getItem('DEBUG_FILLET_SELECTION') === '1'
      ) {
        const live = modelingActor.getSnapshot().context.selectionRanges
        const submitted = (
          context.argumentsToSubmit as ModelingCommandSchema['Fillet']
        ).selection
        const other = submitted?.otherSelections
        const g0 = submitted?.graphSelections?.[0]
        console.info('[fillet review debug]', {
          submittedGraph: submitted?.graphSelections?.length ?? 0,
          engineTopologyFallback: g0?.engineTopologyFallback,
          submittedOther: other?.length ?? 0,
          submittedOtherKinds: other?.map((s) => {
            if (typeof s === 'string') {
              return { kind: 'string' as const, value: s }
            }
            if (s && typeof s === 'object' && 'type' in s) {
              const o = s as { type: string; primitiveType?: string }
              return {
                kind: o.type,
                primitiveType: o.primitiveType,
              }
            }
            return { kind: 'unknown' as const }
          }),
          liveGraph: live?.graphSelections?.length ?? 0,
          liveOther: live?.otherSelections?.length ?? 0,
        })
      }
      const filletArgs = {
        ...(context.argumentsToSubmit as ModelingCommandSchema['Fillet']),
      }
      const liveSel = modelingActor.getSnapshot().context.selectionRanges
      const selectionForFillet = mergeEngineTopologyFallbackFromLiveSelection(
        filletArgs.selection,
        liveSel
      )
      const sel = selectionForFillet ?? filletArgs.selection
      if (
        typeof localStorage !== 'undefined' &&
        localStorage.getItem('DEBUG_FILLET_SELECTION') === '1'
      ) {
        console.info('[fillet review debug post-merge]', {
          graphSelections: sel?.graphSelections?.map((g, i) => ({
            i,
            entityRefType: g.entityRef?.type,
            hasCodeRefPath: Boolean(g.codeRef?.pathToNode),
            hasEngineTopologyFallbackKey: Boolean(g.engineTopologyFallback),
            hasSnakeEngineTopologyFallback: Boolean(
              (g as { engine_topology_fallback?: unknown })
                .engine_topology_fallback
            ),
            engineTopologyFallback: g.engineTopologyFallback ?? null,
            engine_topology_fallback:
              (g as { engine_topology_fallback?: unknown })
                .engine_topology_fallback ?? null,
            normalized: getEngineTopologyFallbackNormalized(g),
          })),
        })
      }
      const modRes = addFillet({
        ...filletArgs,
        selection: sel,
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await kclManager.wasmInstancePromise,
      })
      if (err(modRes)) {
        console.info(
          '[Fillet reviewValidation] addFillet returned error (see message — matches one of the "codemod:" strings in edges.ts)',
          modRes.message
        )
        return modRes
      }
      const execRes = await mockExecAstAndReportErrors(
        modRes.modifiedAst,
        rustContext
      )
      if (err(execRes)) {
        console.info(
          '[Fillet reviewValidation] mockExecAstAndReportErrors error',
          execRes.message
        )
        return execRes
      }
    },
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      selection: {
        inputType: 'selection',
        selectionTypes: [
          'segment',
          'primitiveEdge',
          'enginePrimitiveEdge',
          'edgeCut',
        ],
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
      const chamferArgs = {
        ...(context.argumentsToSubmit as ModelingCommandSchema['Chamfer']),
      }
      const liveSelChamfer = modelingActor.getSnapshot().context.selectionRanges
      const selectionForChamfer = mergeEngineTopologyFallbackFromLiveSelection(
        chamferArgs.selection,
        liveSelChamfer
      )
      const modRes = addChamfer({
        ...chamferArgs,
        selection: selectionForChamfer ?? chamferArgs.selection,
        ast: kclManager.ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance: await kclManager.wasmInstancePromise,
      })
      if (err(modRes)) return modRes
      if (modRes.pathToNode.length === 0) {
        return new Error(
          'Chamfer could not resolve the selection to edges. Ensure an edge is selected.'
        )
      }
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
        selectionTypes: [
          'segment',
          'primitiveEdge',
          'enginePrimitiveEdge',
          'edgeCut',
        ],
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
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
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
      opacity: {
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
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
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
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
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
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      x: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_SCALE,
        required: false,
      },
      y: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_SCALE,
        required: false,
      },
      z: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_SCALE,
        required: false,
      },
      factor: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_SCALE,
        required: false,
      },
      global: {
        inputType: 'boolean',
        required: false,
      },
    },
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
      bodies: {
        ...objectsTypesAndFilters,
        inputType: 'selectionMixed',
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      across: {
        inputType: 'selectionMixed',
        selectionTypes: [
          'plane',
          'cap',
          'wall',
          'edgeCut',
          'segment',
          'sweepEdge',
          'primitiveFace',
          'primitiveEdge',
          'enginePrimitiveFace',
          'enginePrimitiveEdge',
        ],
        multiple: false,
        required: true,
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
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
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
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
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
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
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
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      tolerance: {
        inputType: 'kcl',
        defaultValue: getDefaultGdtTolerance,
        valueSummary: gdtToleranceValueSummary,
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
      leaderScale: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LEADER_SCALE,
        required: false,
      },
      fontSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SIZE,
        required: false,
      },
    },
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
    status: 'experimental',
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      objects: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      tolerance: {
        inputType: 'kcl',
        defaultValue: getDefaultGdtTolerance,
        valueSummary: gdtToleranceValueSummary,
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
      leaderScale: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LEADER_SCALE,
        required: false,
      },
      fontSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SIZE,
        required: false,
      },
    },
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
    status: 'experimental',
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      objects: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      tolerance: {
        inputType: 'kcl',
        defaultValue: getDefaultGdtTolerance,
        valueSummary: gdtToleranceValueSummary,
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
      leaderScale: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LEADER_SCALE,
        required: false,
      },
      fontSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SIZE,
        required: false,
      },
    },
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
    status: 'experimental',
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      objects: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      tolerance: {
        inputType: 'kcl',
        defaultValue: getDefaultGdtTolerance,
        valueSummary: gdtToleranceValueSummary,
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
      leaderScale: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LEADER_SCALE,
        required: false,
      },
      fontSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SIZE,
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
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
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
      leaderScale: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LEADER_SCALE,
        required: false,
      },
      fontSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SIZE,
        required: false,
      },
    },
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
    status: 'experimental',
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      objects: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      datums: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_DATUM_REFS,
        allowArrays: true,
        allowStringArrays: true,
        allowUncalculated: true,
        inputToKclValue: datumInputToKclArray,
        kclValueToInput: kclDatumArrayToInput,
        valueSummary: summarizeDatumKclValue,
        required: false,
      },
      tolerance: {
        inputType: 'kcl',
        defaultValue: getDefaultGdtTolerance,
        valueSummary: gdtToleranceValueSummary,
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
      leaderScale: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LEADER_SCALE,
        required: false,
      },
      fontSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SIZE,
        required: false,
      },
    },
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
    status: 'experimental',
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      edges: {
        inputType: 'selection',
        selectionTypes: ['segment', 'sweepEdge'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      datums: createGdtDatumsArg(false),
      tolerance: {
        inputType: 'kcl',
        defaultValue: getDefaultGdtTolerance,
        valueSummary: gdtToleranceValueSummary,
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
      leaderScale: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LEADER_SCALE,
        required: false,
      },
      fontSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SIZE,
        required: false,
      },
    },
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
    status: 'experimental',
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      objects: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      tolerance: {
        inputType: 'kcl',
        defaultValue: getDefaultGdtTolerance,
        valueSummary: gdtToleranceValueSummary,
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
      leaderScale: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LEADER_SCALE,
        required: false,
      },
      fontSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SIZE,
        required: false,
      },
    },
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
    status: 'experimental',
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      objects: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      datums: createGdtDatumsArg(false),
      tolerance: {
        inputType: 'kcl',
        defaultValue: getDefaultGdtTolerance,
        valueSummary: gdtToleranceValueSummary,
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
      leaderScale: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LEADER_SCALE,
        required: false,
      },
      fontSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SIZE,
        required: false,
      },
    },
  },
  'GDT Angularity': {
    description:
      'Add angularity geometric dimensioning & tolerancing annotation to faces and edges.',
    icon: 'angle',
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
      const modRes = addAngularityGdt({
        ...(context.argumentsToSubmit as ModelingCommandSchema['GDT Angularity']),
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
      objects: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      datums: createGdtDatumsArg(false),
      tolerance: {
        inputType: 'kcl',
        defaultValue: getDefaultGdtTolerance,
        valueSummary: gdtToleranceValueSummary,
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
      leaderScale: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LEADER_SCALE,
        required: false,
      },
      fontSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SIZE,
        required: false,
      },
    },
  },
  'GDT Concentricity': {
    description:
      'Add concentricity geometric dimensioning & tolerancing annotation to faces and edges.',
    icon: 'gdtConcentricity',
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
      const modRes = addConcentricityGdt({
        ...(context.argumentsToSubmit as ModelingCommandSchema['GDT Concentricity']),
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
      objects: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      datums: createGdtDatumsArg(true),
      tolerance: {
        inputType: 'kcl',
        defaultValue: getDefaultGdtTolerance,
        valueSummary: gdtToleranceValueSummary,
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
      leaderScale: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LEADER_SCALE,
        required: false,
      },
      fontSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SIZE,
        required: false,
      },
    },
  },
  'GDT Symmetry': {
    description:
      'Add symmetry geometric dimensioning & tolerancing annotation to faces and edges.',
    icon: 'gdtSymmetry',
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
      const modRes = addSymmetryGdt({
        ...(context.argumentsToSubmit as ModelingCommandSchema['GDT Symmetry']),
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
      objects: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      datums: createGdtDatumsArg(true),
      tolerance: {
        inputType: 'kcl',
        defaultValue: getDefaultGdtTolerance,
        valueSummary: gdtToleranceValueSummary,
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
      leaderScale: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LEADER_SCALE,
        required: false,
      },
      fontSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SIZE,
        required: false,
      },
    },
  },
  'GDT Runout': {
    description:
      'Add runout geometric dimensioning & tolerancing annotation to faces and edges.',
    icon: 'gdtRunout',
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
      const modRes = addRunoutGdt({
        ...(context.argumentsToSubmit as ModelingCommandSchema['GDT Runout']),
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
      objects: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      datums: createGdtDatumsArg(true),
      tolerance: {
        inputType: 'kcl',
        defaultValue: getDefaultGdtTolerance,
        valueSummary: gdtToleranceValueSummary,
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
      leaderScale: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LEADER_SCALE,
        required: false,
      },
      fontSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SIZE,
        required: false,
      },
    },
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
    status: 'experimental',
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      objects: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      datums: createGdtDatumsArg(false),
      tolerance: {
        inputType: 'kcl',
        defaultValue: getDefaultGdtTolerance,
        valueSummary: gdtToleranceValueSummary,
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
      leaderScale: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LEADER_SCALE,
        required: false,
      },
      fontSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SIZE,
        required: false,
      },
    },
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
    status: 'experimental',
    args: {
      nodeToEdit: {
        ...nodeToEditProps,
      },
      objects: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall', 'edgeCut', 'segment', 'sweepEdge'],
        multiple: true,
        required: true,
        hidden: (context) => Boolean(context.argumentsToSubmit.nodeToEdit),
      },
      annotation: {
        inputType: 'text',
        defaultValue: 'Break all sharp edges',
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
      leaderScale: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_LEADER_SCALE,
        required: false,
      },
      fontSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SIZE,
        required: false,
      },
    },
  },
  'GDT Note': {
    description: 'Add a free-floating model-based definition note on a plane.',
    icon: 'note',
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
      const modRes = addNoteGdt({
        ...(context.argumentsToSubmit as ModelingCommandSchema['GDT Note']),
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
      note: {
        inputType: 'text',
        defaultValue: 'Note:',
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
        options: FRAME_PLANE_OPTIONS,
        required: false,
      },
      fontSize: {
        inputType: 'kcl',
        defaultValue: KCL_DEFAULT_FONT_SIZE,
        required: false,
      },
    },
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
    args: {
      surface: {
        ...objectsTypesAndFilters,
        inputType: 'selectionMixed',
        multiple: true,
        required: true,
      },
    },
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
    args: {
      selection: {
        ...objectsTypesAndFilters,
        inputType: 'selectionMixed',
        multiple: true,
        required: true,
      },
    },
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
    args: {
      faces: {
        inputType: 'selection',
        selectionTypes: ['cap', 'wall', 'primitiveFace', 'enginePrimitiveFace'],
        multiple: true,
        required: true,
      },
    },
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
    args: {
      edges: {
        inputType: 'selection',
        selectionTypes: ['segment', 'primitiveEdge', 'enginePrimitiveEdge'],
        multiple: true,
        required: true,
        description: 'Only straight edges are supported now.',
      },
    },
  },
}

// TODO: update modelingMachineCommandConfig with satisfies?
