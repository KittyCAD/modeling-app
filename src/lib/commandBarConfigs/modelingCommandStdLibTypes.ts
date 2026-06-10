import type {
  STD_LIB_COMMANDS,
  StdLibCommandName,
} from '@rust/kcl-lib/bindings/StdLibCommands'

import type { HoleBody, HoleBottom, HoleType } from '@src/lang/modifyAst/faces'
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
  Omit<StdLibCommandArgs<'extrude'>, 'direction'>,
  {
    method?: KclPreludeExtrudeMethod
    bodyType?: KclPreludeBodyType
  }
>

export type SweepCommandArgs = Override<
  Omit<StdLibCommandArgs<'sweep'>, 'tolerance' | 'version'>,
  {
    relativeTo?: SweepRelativeTo
    bodyType?: KclPreludeBodyType
  }
>

export type LoftCommandArgs = Override<
  Omit<StdLibCommandArgs<'loft'>, 'tolerance'>,
  {
    bodyType?: KclPreludeBodyType
  }
>

export type RevolveCommandArgs = Override<
  Omit<StdLibCommandArgs<'revolve'>, 'axis' | 'tolerance'>,
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
  Omit<StdLibCommandArgs<'fillet'>, 'solid' | 'tags' | 'tolerance'>,
  {
    selection: Selections
    radius: KclCommandValue
    tag?: string
  }
>

export type ChamferCommandArgs = Override<
  Omit<StdLibCommandArgs<'chamfer'>, 'solid' | 'tags'>,
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

export type TranslateCommandArgs = Omit<StdLibCommandArgs<'translate'>, 'xyz'>

export type RotateCommandArgs = Omit<
  StdLibCommandArgs<'rotate'>,
  'axis' | 'angle'
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
    axis: string
    center: KclCommandValue
  }
>

export type PatternLinear3DCommandArgs = Override<
  StdLibCommandArgs<'patternLinear3d'>,
  { axis: string }
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
  StdLibCommandArgs<'gdt::profile'>,
  GdtFrameArgs
>
export type GdtDistanceCommandArgs = Override<
  Omit<StdLibCommandArgs<'gdt::distance'>, 'from' | 'to' | 'edges'>,
  { objects: Selections } & GdtFrameArgs
>
export type GdtPerpendicularityCommandArgs =
  GdtObjectsCommandArgs<'gdt::perpendicularity'>
export type GdtAngularityCommandArgs = GdtObjectsCommandArgs<'gdt::angularity'>
export type GdtParallelismCommandArgs =
  GdtObjectsCommandArgs<'gdt::parallelism'>
export type GdtAnnotationCommandArgs = GdtObjectsCommandArgs<'gdt::annotation'>
export type GdtDatumCommandArgs = Override<
  Omit<StdLibCommandArgs<'gdt::datum'>, 'face'>,
  { faces: Selections } & GdtFrameArgs
>

export type BooleanSubtractCommandArgs = Omit<
  StdLibCommandArgs<'subtract'>,
  'tolerance' | 'legacyMethod'
>
export type BooleanUnionCommandArgs = Omit<
  StdLibCommandArgs<'union'>,
  'tolerance' | 'legacyMethod'
>
export type BooleanIntersectCommandArgs = Omit<
  StdLibCommandArgs<'intersect'>,
  'tolerance' | 'legacyMethod'
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
export type JoinSurfacesCommandArgs = Omit<
  StdLibCommandArgs<'joinSurfaces'>,
  'tolerance'
>
