import type {
  STD_LIB_COMMANDS,
  StdLibCommandName,
} from '@src/lib/commandBarConfigs/modelingCommandStdLibCommands'

import type { HoleBody, HoleBottom, HoleType } from '@src/lang/modifyAst/faces'
import type { ProfileGdtFunction } from '@src/lang/modifyAst/gdt'
import type { SweepRelativeTo } from '@src/lang/modifyAst/sweeps'
import type { KclCommandValue } from '@src/lib/commandTypes'
import type {
  KclPreludeBodyType,
  KclPreludeExtrudeMethod,
} from '@src/lib/constants'
import type { Selections } from '@src/machines/modelingSharedTypes'

// Adapts generated KCL stdlib metadata into the command-bar argument shapes.
// UI-specific aliases and omissions stay explicit here.
type StdLibCommandArg<Name extends StdLibCommandName> =
  (typeof STD_LIB_COMMANDS)[Name]['args'][number]

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

type StdLibCommandArgs<Name extends StdLibCommandName> = {
  [Arg in StdLibCommandArg<Name> as Arg['required'] extends true
    ? Arg['name']
    : never]: StdLibCommandArgValue<Arg>
} & {
  [Arg in StdLibCommandArg<Name> as Arg['required'] extends false
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

type GdtObjectsCommandArgs<Name extends StdLibCommandName> = GdtObjectsArgs<
  StdLibCommandArgs<Name>
>

export type HelixModes = 'Axis' | 'Edge' | 'Cylinder'

export type ExtrudeCommandArgs = Override<
  StdLibCommandArgs<'extrude'>,
  {
    direction?: Selections
    method?: KclPreludeExtrudeMethod
    bodyType?: KclPreludeBodyType
  }
>

export type SweepCommandArgs = Override<
  StdLibCommandArgs<'sweep'>,
  {
    relativeTo?: SweepRelativeTo
    bodyType?: KclPreludeBodyType
  }
>

export type LoftCommandArgs = Override<
  StdLibCommandArgs<'loft'>,
  {
    bodyType?: KclPreludeBodyType
  }
>

export type RevolveCommandArgs = Override<
  Omit<StdLibCommandArgs<'revolve'>, 'axis'>,
  {
    axisOrEdge: 'Axis' | 'Edge'
    axis: string | undefined
    edge: Selections | undefined
    angle: KclCommandValue
    bodyType?: KclPreludeBodyType
  }
>

export type ShellCommandArgs = Omit<StdLibCommandArgs<'shell'>, 'solids'>

export type HoleCommandArgs = Override<
  Omit<StdLibCommandArgs<'hole::hole'>, 'solid'>,
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
  Omit<StdLibCommandArgs<'fillet'>, 'solid' | 'tags' | 'edges'>,
  {
    selection: Selections
    radius: KclCommandValue
    tag?: string
  }
>

export type ChamferCommandArgs = Override<
  Omit<StdLibCommandArgs<'chamfer'>, 'solid' | 'tags' | 'edges'>,
  {
    selection: Selections
    length: KclCommandValue
    secondLength?: KclCommandValue
    angle?: KclCommandValue
    tag?: string
  }
>

export type OffsetPlaneCommandArgs = StdLibCommandArgs<'offsetPlane'>

export type HelixCommandArgs = Override<
  Omit<StdLibCommandArgs<'helix'>, 'axis'>,
  {
    mode: HelixModes
    axis?: string
    edge?: Selections
  }
>

export type HelicalGearCommandArgs = StdLibCommandArgs<'gear::helical'>
export type HerringboneGearCommandArgs = StdLibCommandArgs<'gear::herringbone'>
export type SpurGearCommandArgs = StdLibCommandArgs<'gear::spur'>
export type RingGearCommandArgs = StdLibCommandArgs<'gear::ring'>

export type AppearanceCommandArgs = Override<
  Omit<StdLibCommandArgs<'appearance'>, 'solids'>,
  {
    objects: Selections
    color: string
  }
>

export type DeleteCommandArgs = StdLibCommandArgs<'delete'>

export type TranslateCommandArgs = StdLibCommandArgs<'translate'>

export type RotateCommandArgs = Override<
  StdLibCommandArgs<'rotate'>,
  {
    axis?: KclCommandValue | string
  }
>

export type ScaleCommandArgs = StdLibCommandArgs<'scale'>

export type CloneCommandArgs = Override<
  Omit<StdLibCommandArgs<'clone'>, 'geometries'>,
  {
    objects: Selections
    variableName: string
  }
>

export type Mirror3DCommandArgs = StdLibCommandArgs<'mirror3d'>

export type PatternCircular3DCommandArgs = Override<
  StdLibCommandArgs<'patternCircular3d'>,
  {
    axis: KclCommandValue | string
    center: KclCommandValue
  }
>

export type PatternLinear3DCommandArgs = Override<
  StdLibCommandArgs<'patternLinear3d'>,
  { axis: KclCommandValue | string }
>

export type GdtFlatnessCommandArgs = Override<
  StdLibCommandArgs<'gdt::flatness'>,
  GdtFrameArgs
>
export type GdtStraightnessCommandArgs =
  GdtObjectsCommandArgs<'gdt::straightness'>
export type GdtCircularityCommandArgs =
  GdtObjectsCommandArgs<'gdt::circularity'>
export type GdtCylindricityCommandArgs =
  GdtObjectsCommandArgs<'gdt::cylindricity'>
export type GdtPositionCommandArgs = GdtObjectsCommandArgs<'gdt::position'>
export type GdtProfileCommandArgs = Override<
  Omit<StdLibCommandArgs<'gdt::profileLine'>, 'edges'>,
  {
    objects: Selections
    profileFunction?: ProfileGdtFunction
  } & GdtFrameArgs
>
export type GdtDistanceCommandArgs = Override<
  Omit<StdLibCommandArgs<'gdt::distance'>, 'from' | 'to' | 'edges'>,
  { objects: Selections } & GdtFrameArgs
>
export type GdtPerpendicularityCommandArgs =
  GdtObjectsCommandArgs<'gdt::perpendicularity'>
export type GdtAngularityCommandArgs = GdtObjectsCommandArgs<'gdt::angularity'>
export type GdtConcentricityCommandArgs =
  GdtObjectsCommandArgs<'gdt::concentricity'>
export type GdtSymmetryCommandArgs = GdtObjectsCommandArgs<'gdt::symmetry'>
export type GdtRunoutCommandArgs = GdtObjectsCommandArgs<'gdt::runout'>
export type GdtParallelismCommandArgs =
  GdtObjectsCommandArgs<'gdt::parallelism'>
export type GdtAnnotationCommandArgs = GdtObjectsCommandArgs<'gdt::annotation'>
export type GdtNoteCommandArgs = Override<
  StdLibCommandArgs<'gdt::note'>,
  GdtFrameArgs
>
export type GdtDatumCommandArgs = Override<
  Omit<StdLibCommandArgs<'gdt::datum'>, 'face'>,
  { faces: Selections } & GdtFrameArgs
>

export type BooleanSubtractCommandArgs = Omit<
  StdLibCommandArgs<'subtract'>,
  'legacyMethod'
>
export type BooleanUnionCommandArgs = Omit<
  StdLibCommandArgs<'union'>,
  'legacyMethod'
>
export type BooleanIntersectCommandArgs = Omit<
  StdLibCommandArgs<'intersect'>,
  'legacyMethod'
>
export type BooleanSplitCommandArgs = Omit<
  StdLibCommandArgs<'split'>,
  'legacyMethod'
>
export type FlipSurfaceCommandArgs = StdLibCommandArgs<'flipSurface'>
export type DeleteFaceCommandArgs = Override<
  Omit<StdLibCommandArgs<'deleteFace'>, 'body' | 'faceIndices'>,
  { faces: Selections }
>
export type BlendCommandArgs = StdLibCommandArgs<'blend'>
export type JoinSurfacesCommandArgs = StdLibCommandArgs<'joinSurfaces'>

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
