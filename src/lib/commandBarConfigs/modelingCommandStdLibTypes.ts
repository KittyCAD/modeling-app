import type { HoleBody, HoleBottom, HoleType } from '@src/lang/modifyAst/faces'
import type { ProfileGdtFunction } from '@src/lang/modifyAst/gdt'
import type { SweepRelativeTo } from '@src/lang/modifyAst/sweeps'
import type {
  ModelingStdLibCommandName,
  modelingCommandStdLibDriftConfig,
} from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type {
  STD_LIB_COMMANDS,
  StdLibCommandName,
} from '@src/lib/commandBarConfigs/modelingCommandStdLibCommands'
import type { KclCommandValue } from '@src/lib/commandTypes'
import type {
  KclPreludeBodyType,
  KclPreludeExtrudeMethod,
} from '@src/lib/constants'
import type { Selections } from '@src/machines/modelingSharedTypes'

// Adapts generated KCL stdlib metadata into command-bar argument shapes.
// Intentional omissions and deprecated inclusions come from the drift config.
type DriftConfig = typeof modelingCommandStdLibDriftConfig

type ConfiguredArgNames<
  Name extends ModelingStdLibCommandName,
  Key extends 'omittedStdLibArgs' | 'deprecatedStdLibArgs',
> = DriftConfig[Name] extends Record<
  Key,
  readonly (infer ArgName extends string)[]
>
  ? ArgName
  : never

type ConfiguredStdLibName<Name extends ModelingStdLibCommandName> =
  DriftConfig[Name]['stdLibName'] & StdLibCommandName

type StdLibArgForCommand<Name extends ModelingStdLibCommandName> =
  (typeof STD_LIB_COMMANDS)[ConfiguredStdLibName<Name>]['args'][number]

// The drift config is the source of truth: active args are included by default,
// deprecated args opt in, and explicit omissions always win.
type PointAndClickStdLibCommandArg<
  Name extends ModelingStdLibCommandName,
  Arg = StdLibArgForCommand<Name>,
> = Arg extends { readonly name: infer ArgName extends string }
  ? ArgName extends ConfiguredArgNames<Name, 'omittedStdLibArgs'>
    ? never
    : Arg extends {
          readonly deprecated: false
          readonly deprecatedSince: null
        }
      ? Arg
      : ArgName extends ConfiguredArgNames<Name, 'deprecatedStdLibArgs'>
        ? Arg
        : never
  : never

type StdLibCommandArgValue<Arg extends { readonly ty: string | null }> =
  Arg['ty'] extends 'bool'
    ? boolean
    : Arg['ty'] extends 'string' | 'TagDecl'
      ? string
      : Arg['ty'] extends
            | `number${string}`
            | 'Point2d'
            | 'Point3d'
            | `[number${string}; ${string}]`
            | `[string; ${string}]`
        ? KclCommandValue
        : Selections

type PointAndClickCommandArgs<Name extends ModelingStdLibCommandName> = {
  [Arg in PointAndClickStdLibCommandArg<Name> as Arg['required'] extends true
    ? Arg['name']
    : never]: StdLibCommandArgValue<Arg>
} & {
  [Arg in PointAndClickStdLibCommandArg<Name> as Arg['required'] extends false
    ? Arg['name']
    : never]?: StdLibCommandArgValue<Arg>
}

type Override<Base, Overrides> = Omit<Base, keyof Overrides> & Overrides

type GdtFrameArgs = {
  framePlane?: string
}

type GdtObjectsArgs<Base> = Override<
  Omit<Base, 'faces' | 'edges'>,
  { objects: Selections } & GdtFrameArgs
>

type GdtObjectsCommandArgs<Name extends ModelingStdLibCommandName> =
  GdtObjectsArgs<PointAndClickCommandArgs<Name>>

export type HelixModes = 'Axis' | 'Edge' | 'Cylinder'

export type ExtrudeCommandArgs = Override<
  PointAndClickCommandArgs<'Extrude'>,
  {
    direction?: Selections
    method?: KclPreludeExtrudeMethod
    bodyType?: KclPreludeBodyType
  }
>

export type SweepCommandArgs = Override<
  PointAndClickCommandArgs<'Sweep'>,
  {
    relativeTo?: SweepRelativeTo
    bodyType?: KclPreludeBodyType
  }
>

export type LoftCommandArgs = Override<
  PointAndClickCommandArgs<'Loft'>,
  {
    bodyType?: KclPreludeBodyType
  }
>

export type RevolveCommandArgs = Override<
  Omit<PointAndClickCommandArgs<'Revolve'>, 'axis'>,
  {
    axisOrEdge: 'Axis' | 'Edge'
    axis: string | undefined
    edge: Selections | undefined
    angle: KclCommandValue
    bodyType?: KclPreludeBodyType
  }
>

export type ShellCommandArgs = PointAndClickCommandArgs<'Shell'>

export type HoleCommandArgs = Override<
  PointAndClickCommandArgs<'Hole'>,
  {
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
>

export type FilletCommandArgs = Override<
  Omit<PointAndClickCommandArgs<'Fillet'>, 'tags'>,
  {
    selection: Selections
    radius: KclCommandValue
    tag?: string
  }
>

export type ChamferCommandArgs = Override<
  Omit<PointAndClickCommandArgs<'Chamfer'>, 'tags'>,
  {
    selection: Selections
    length: KclCommandValue
    secondLength?: KclCommandValue
    angle?: KclCommandValue
    tag?: string
  }
>

export type OffsetPlaneCommandArgs = PointAndClickCommandArgs<'Offset plane'>

export type HelixCommandArgs = Override<
  Omit<PointAndClickCommandArgs<'Helix'>, 'axis'>,
  {
    mode: HelixModes
    axis?: string
    edge?: Selections
  }
>

export type HelicalGearCommandArgs = PointAndClickCommandArgs<'Helical Gear'>
export type HerringboneGearCommandArgs =
  PointAndClickCommandArgs<'Herringbone Gear'>
export type SpurGearCommandArgs = PointAndClickCommandArgs<'Spur Gear'>
export type RingGearCommandArgs = PointAndClickCommandArgs<'Ring Gear'>

export type AppearanceCommandArgs = Override<
  Omit<PointAndClickCommandArgs<'Appearance'>, 'solids'>,
  {
    objects: Selections
    color: string
  }
>

export type DeleteCommandArgs = PointAndClickCommandArgs<'Delete'>

export type TranslateCommandArgs = PointAndClickCommandArgs<'Translate'>

export type RotateCommandArgs = Override<
  PointAndClickCommandArgs<'Rotate'>,
  {
    axis?: string
  }
>

export type ScaleCommandArgs = PointAndClickCommandArgs<'Scale'>

export type CloneCommandArgs = Override<
  Omit<PointAndClickCommandArgs<'Clone'>, 'geometries'>,
  {
    objects: Selections
    variableName: string
  }
>

export type Mirror3DCommandArgs = PointAndClickCommandArgs<'Mirror 3D'>

export type PatternCircular3DCommandArgs = Override<
  PointAndClickCommandArgs<'Pattern Circular 3D'>,
  {
    axis: string
    center: KclCommandValue
  }
>

export type PatternLinear3DCommandArgs = Override<
  PointAndClickCommandArgs<'Pattern Linear 3D'>,
  { axis: string }
>

export type GdtFlatnessCommandArgs = Override<
  PointAndClickCommandArgs<'GDT Flatness'>,
  GdtFrameArgs
>
export type GdtStraightnessCommandArgs =
  GdtObjectsCommandArgs<'GDT Straightness'>
export type GdtCircularityCommandArgs = GdtObjectsCommandArgs<'GDT Circularity'>
export type GdtCylindricityCommandArgs =
  GdtObjectsCommandArgs<'GDT Cylindricity'>
export type GdtPositionCommandArgs = GdtObjectsCommandArgs<'GDT Position'>
export type GdtProfileCommandArgs = Override<
  Omit<PointAndClickCommandArgs<'GDT Profile'>, 'edges'>,
  {
    objects: Selections
    profileFunction?: ProfileGdtFunction
  } & GdtFrameArgs
>
export type GdtDistanceCommandArgs = Override<
  Omit<PointAndClickCommandArgs<'GDT Distance'>, 'from' | 'to' | 'edges'>,
  { objects: Selections } & GdtFrameArgs
>
export type GdtPerpendicularityCommandArgs =
  GdtObjectsCommandArgs<'GDT Perpendicularity'>
export type GdtAngularityCommandArgs = GdtObjectsCommandArgs<'GDT Angularity'>
export type GdtConcentricityCommandArgs =
  GdtObjectsCommandArgs<'GDT Concentricity'>
export type GdtSymmetryCommandArgs = GdtObjectsCommandArgs<'GDT Symmetry'>
export type GdtRunoutCommandArgs = GdtObjectsCommandArgs<'GDT Runout'>
export type GdtParallelismCommandArgs = GdtObjectsCommandArgs<'GDT Parallelism'>
export type GdtAnnotationCommandArgs = GdtObjectsCommandArgs<'GDT Annotation'>
export type GdtNoteCommandArgs = Override<
  PointAndClickCommandArgs<'GDT Note'>,
  GdtFrameArgs
>
export type GdtDatumCommandArgs = Override<
  Omit<PointAndClickCommandArgs<'GDT Datum'>, 'face'>,
  { faces: Selections } & GdtFrameArgs
>

export type BooleanSubtractCommandArgs =
  PointAndClickCommandArgs<'Boolean Subtract'>
export type BooleanUnionCommandArgs = PointAndClickCommandArgs<'Boolean Union'>
export type BooleanIntersectCommandArgs =
  PointAndClickCommandArgs<'Boolean Intersect'>
export type BooleanSplitCommandArgs = PointAndClickCommandArgs<'Boolean Split'>
export type FlipSurfaceCommandArgs = PointAndClickCommandArgs<'Flip Surface'>
export type DeleteFaceCommandArgs = Override<
  PointAndClickCommandArgs<'Delete Face'>,
  { faces: Selections }
>
export type BlendCommandArgs = PointAndClickCommandArgs<'Blend'>
export type JoinSurfacesCommandArgs = PointAndClickCommandArgs<'Join Surfaces'>

export type StdLibModelingCommandSchema = {
  Extrude: ExtrudeCommandArgs
  Sweep: SweepCommandArgs
  Loft: LoftCommandArgs
  Revolve: RevolveCommandArgs
  Shell: ShellCommandArgs
  Hole: HoleCommandArgs
  Fillet: FilletCommandArgs
  Chamfer: ChamferCommandArgs
  'Offset plane': OffsetPlaneCommandArgs
  Helix: HelixCommandArgs
  'Helical Gear': HelicalGearCommandArgs
  'Herringbone Gear': HerringboneGearCommandArgs
  'Spur Gear': SpurGearCommandArgs
  'Ring Gear': RingGearCommandArgs
  Appearance: AppearanceCommandArgs
  Delete: DeleteCommandArgs
  Translate: TranslateCommandArgs
  Rotate: RotateCommandArgs
  Scale: ScaleCommandArgs
  Clone: CloneCommandArgs
  'Mirror 3D': Mirror3DCommandArgs
  'Pattern Circular 3D': PatternCircular3DCommandArgs
  'Pattern Linear 3D': PatternLinear3DCommandArgs
  'GDT Flatness': GdtFlatnessCommandArgs
  'GDT Straightness': GdtStraightnessCommandArgs
  'GDT Circularity': GdtCircularityCommandArgs
  'GDT Cylindricity': GdtCylindricityCommandArgs
  'GDT Position': GdtPositionCommandArgs
  'GDT Profile': GdtProfileCommandArgs
  'GDT Distance': GdtDistanceCommandArgs
  'GDT Perpendicularity': GdtPerpendicularityCommandArgs
  'GDT Angularity': GdtAngularityCommandArgs
  'GDT Concentricity': GdtConcentricityCommandArgs
  'GDT Symmetry': GdtSymmetryCommandArgs
  'GDT Runout': GdtRunoutCommandArgs
  'GDT Parallelism': GdtParallelismCommandArgs
  'GDT Annotation': GdtAnnotationCommandArgs
  'GDT Note': GdtNoteCommandArgs
  'GDT Datum': GdtDatumCommandArgs
  'Boolean Subtract': BooleanSubtractCommandArgs
  'Boolean Union': BooleanUnionCommandArgs
  'Boolean Intersect': BooleanIntersectCommandArgs
  'Boolean Split': BooleanSplitCommandArgs
  'Flip Surface': FlipSurfaceCommandArgs
  'Delete Face': DeleteFaceCommandArgs
  Blend: BlendCommandArgs
  'Join Surfaces': JoinSurfacesCommandArgs
}
