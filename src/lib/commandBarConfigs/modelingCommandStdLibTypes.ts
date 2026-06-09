import type {
  STD_LIB_COMMANDS,
  StdLibCommandName,
} from '@rust/kcl-lib/bindings/StdLibCommands'

import type { HoleBody, HoleBottom, HoleType } from '@src/lang/modifyAst/faces'
import type { SweepRelativeTo } from '@src/lang/modifyAst/sweeps'
import type { PathToNode } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import type {
  KclPreludeBodyType,
  KclPreludeExtrudeMethod,
} from '@src/lib/constants'
import type { Selections } from '@src/machines/modelingSharedTypes'

// Adapts generated KCL stdlib metadata into the command-bar argument shapes.
// UI-specific aliases, omissions, and edit-flow fields stay explicit here.
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
type WithNodeToEdit<Base> = Base & { nodeToEdit?: PathToNode }

type GdtFrameArgs = {
  framePlane?: string
}

type GdtObjectsArgs<Base> = Override<
  Omit<Base, 'faces' | 'edges'>,
  { objects: Selections } & GdtFrameArgs
>

type GdtObjectsCommandArgs<Name extends StdLibCommandName> = WithNodeToEdit<
  GdtObjectsArgs<StdLibCommandArgs<Name>>
>

export type HelixModes = 'Axis' | 'Edge' | 'Cylinder'

export type ExtrudeCommandArgs = WithNodeToEdit<
  Override<
    Omit<StdLibCommandArgs<'extrude'>, 'direction'>,
    {
      method?: KclPreludeExtrudeMethod
      bodyType?: KclPreludeBodyType
    }
  >
>

export type SweepCommandArgs = WithNodeToEdit<
  Override<
    Omit<StdLibCommandArgs<'sweep'>, 'tolerance' | 'version'>,
    {
      relativeTo?: SweepRelativeTo
      bodyType?: KclPreludeBodyType
    }
  >
>

export type LoftCommandArgs = WithNodeToEdit<
  Override<
    Omit<StdLibCommandArgs<'loft'>, 'tolerance'>,
    {
      bodyType?: KclPreludeBodyType
    }
  >
>

export type RevolveCommandArgs = WithNodeToEdit<
  Override<
    Omit<StdLibCommandArgs<'revolve'>, 'axis' | 'tolerance'>,
    {
      axisOrEdge: 'Axis' | 'Edge'
      axis: string | undefined
      edge: Selections | undefined
      angle: KclCommandValue
      bodyType?: KclPreludeBodyType
    }
  >
>

export type ShellCommandArgs = WithNodeToEdit<
  Omit<StdLibCommandArgs<'shell'>, 'solids'>
>

export type HoleCommandArgs = WithNodeToEdit<
  Override<
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
>

export type FilletCommandArgs = WithNodeToEdit<
  Override<
    Omit<StdLibCommandArgs<'fillet'>, 'solid' | 'tags' | 'tolerance'>,
    {
      selection: Selections
      radius: KclCommandValue
      tag?: string
    }
  >
>

export type ChamferCommandArgs = WithNodeToEdit<
  Override<
    Omit<StdLibCommandArgs<'chamfer'>, 'solid' | 'tags'>,
    {
      selection: Selections
      length: KclCommandValue
      secondLength?: KclCommandValue
      angle?: KclCommandValue
      tag?: string
    }
  >
>

export type OffsetPlaneCommandArgs = WithNodeToEdit<
  StdLibCommandArgs<'offsetPlane'>
>

export type HelixCommandArgs = WithNodeToEdit<
  Override<
    Omit<StdLibCommandArgs<'helix'>, 'axis'>,
    {
      mode: HelixModes
      axis?: string
      edge?: Selections
    }
  >
>

export type HelicalGearCommandArgs = WithNodeToEdit<
  StdLibCommandArgs<'gear::helical'>
>
export type HerringboneGearCommandArgs = WithNodeToEdit<
  StdLibCommandArgs<'gear::herringbone'>
>
export type SpurGearCommandArgs = WithNodeToEdit<
  StdLibCommandArgs<'gear::spur'>
>
export type RingGearCommandArgs = WithNodeToEdit<
  StdLibCommandArgs<'gear::ring'>
>

export type AppearanceCommandArgs = WithNodeToEdit<
  Override<
    Omit<StdLibCommandArgs<'appearance'>, 'solids'>,
    {
      objects: Selections
      color: string
    }
  >
>

export type TranslateCommandArgs = WithNodeToEdit<
  Omit<StdLibCommandArgs<'translate'>, 'xyz'>
>

export type RotateCommandArgs = WithNodeToEdit<
  Omit<StdLibCommandArgs<'rotate'>, 'axis' | 'angle'>
>

export type ScaleCommandArgs = WithNodeToEdit<StdLibCommandArgs<'scale'>>

export type CloneCommandArgs = WithNodeToEdit<
  Override<
    Omit<StdLibCommandArgs<'clone'>, 'geometries'>,
    {
      objects: Selections
      variableName: string
    }
  >
>

export type Mirror3DCommandArgs = StdLibCommandArgs<'mirror3d'>

export type PatternCircular3DCommandArgs = WithNodeToEdit<
  Override<
    StdLibCommandArgs<'patternCircular3d'>,
    {
      axis: string
      center: KclCommandValue
    }
  >
>

export type PatternLinear3DCommandArgs = WithNodeToEdit<
  Override<StdLibCommandArgs<'patternLinear3d'>, { axis: string }>
>

export type GdtFlatnessCommandArgs = WithNodeToEdit<
  Override<StdLibCommandArgs<'gdt::flatness'>, GdtFrameArgs>
>
export type GdtStraightnessCommandArgs =
  GdtObjectsCommandArgs<'gdt::straightness'>
export type GdtCircularityCommandArgs =
  GdtObjectsCommandArgs<'gdt::circularity'>
export type GdtCylindricityCommandArgs =
  GdtObjectsCommandArgs<'gdt::cylindricity'>
export type GdtPositionCommandArgs = GdtObjectsCommandArgs<'gdt::position'>
export type GdtProfileCommandArgs = WithNodeToEdit<
  Override<StdLibCommandArgs<'gdt::profile'>, GdtFrameArgs>
>
export type GdtDistanceCommandArgs = WithNodeToEdit<
  Override<
    Omit<StdLibCommandArgs<'gdt::distance'>, 'from' | 'to' | 'edges'>,
    { objects: Selections } & GdtFrameArgs
  >
>
export type GdtPerpendicularityCommandArgs =
  GdtObjectsCommandArgs<'gdt::perpendicularity'>
export type GdtParallelismCommandArgs =
  GdtObjectsCommandArgs<'gdt::parallelism'>
export type GdtAnnotationCommandArgs = GdtObjectsCommandArgs<'gdt::annotation'>
export type GdtDatumCommandArgs = WithNodeToEdit<
  Override<
    Omit<StdLibCommandArgs<'gdt::datum'>, 'face'>,
    { faces: Selections } & GdtFrameArgs
  >
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
export type BooleanSplitCommandArgs = WithNodeToEdit<
  Omit<StdLibCommandArgs<'split'>, 'legacyMethod'>
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
