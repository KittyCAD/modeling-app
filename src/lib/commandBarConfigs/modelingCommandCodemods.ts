import type { Node } from '@rust/kcl-lib/bindings/Node'

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
} from '@src/lang/modifyAst/gdt'
import {
  addHelicalGear,
  addHerringboneGear,
  addRingGear,
  addSpurGear,
} from '@src/lang/modifyAst/gears'
import { addHelix } from '@src/lang/modifyAst/geometry'
import {
  type ModelingCodemod,
  type ModelingCodemodResult,
  defineModelingCodemod,
} from '@src/lang/modifyAst/modelingCodemod'
import {
  addPatternCircular3D,
  addPatternLinear3D,
} from '@src/lang/modifyAst/pattern3D'
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
import type { ArtifactGraph, Program, VariableMap } from '@src/lang/wasm'
import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import { withDefaultGdtFrameDefaults } from '@src/lib/gdtFramePosition'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

type ModelingCommandCodemodConfig<
  CommandName extends keyof ModelingCommandSchema,
> = ModelingCodemod<ModelingCommandSchema[CommandName]>

type ModelingCommandCodemodName =
  | 'Extrude'
  | 'Sweep'
  | 'Loft'
  | 'Revolve'
  | 'Shell'
  | 'Hole'
  | 'Boolean Subtract'
  | 'Boolean Union'
  | 'Boolean Intersect'
  | 'Boolean Split'
  | 'Offset plane'
  | 'Helix'
  | 'Helical Gear'
  | 'Herringbone Gear'
  | 'Spur Gear'
  | 'Ring Gear'
  | 'Fillet'
  | 'Chamfer'
  | 'Appearance'
  | 'Delete'
  | 'Translate'
  | 'Rotate'
  | 'Scale'
  | 'Clone'
  | 'Mirror 3D'
  | 'Pattern Circular 3D'
  | 'Pattern Linear 3D'
  | 'GDT Flatness'
  | 'GDT Straightness'
  | 'GDT Circularity'
  | 'GDT Cylindricity'
  | 'GDT Position'
  | 'GDT Profile'
  | 'GDT Distance'
  | 'GDT Perpendicularity'
  | 'GDT Parallelism'
  | 'GDT Annotation'
  | 'GDT Datum'
  | 'Flip Surface'
  | 'Join Surfaces'
  | 'Delete Face'
  | 'Blend'

type ModelingCommandCodemods = {
  [CommandName in ModelingCommandCodemodName]: ModelingCommandCodemodConfig<CommandName>
}

type AddCodemodArgs<
  CommandName extends keyof ModelingCommandSchema,
  ExtraContext extends object = object,
> = ModelingCommandSchema[CommandName] &
  ExtraContext & {
    ast: Node<Program>
    wasmInstance: ModuleType
  }

type AddCodemod<
  CommandName extends keyof ModelingCommandSchema,
  ExtraContext extends object = object,
> = (args: AddCodemodArgs<CommandName, ExtraContext>) => ModelingCodemodResult

type ModelingCodemodOptions<CommandName extends keyof ModelingCommandSchema> =
  Omit<ModelingCommandCodemodConfig<CommandName>, 'run'>

const withAst = <CommandName extends keyof ModelingCommandSchema>(
  add: AddCodemod<CommandName>,
  options?: ModelingCodemodOptions<CommandName>
) =>
  defineModelingCodemod<ModelingCommandSchema[CommandName]>({
    ...options,
    run: ({ args, ast, wasmInstance }) =>
      add({
        ...args,
        ast,
        wasmInstance,
      } as AddCodemodArgs<CommandName>),
  })

const withArtifactGraph = <CommandName extends keyof ModelingCommandSchema>(
  add: AddCodemod<CommandName, { artifactGraph: ArtifactGraph }>,
  options?: ModelingCodemodOptions<CommandName>
) =>
  defineModelingCodemod<ModelingCommandSchema[CommandName]>({
    ...options,
    run: ({ args, ast, kclManager, wasmInstance }) =>
      add({
        ...args,
        ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance,
      } as unknown as AddCodemodArgs<
        CommandName,
        { artifactGraph: ArtifactGraph }
      >),
  })

const withArtifactGraphAndVariables = <
  CommandName extends keyof ModelingCommandSchema,
>(
  add: AddCodemod<
    CommandName,
    { artifactGraph: ArtifactGraph; variables: VariableMap }
  >,
  options?: ModelingCodemodOptions<CommandName>
) =>
  defineModelingCodemod<ModelingCommandSchema[CommandName]>({
    ...options,
    run: ({ args, ast, kclManager, wasmInstance }) =>
      add({
        ...args,
        ast,
        artifactGraph: kclManager.artifactGraph,
        variables: kclManager.variables,
        wasmInstance,
      } as unknown as AddCodemodArgs<
        CommandName,
        { artifactGraph: ArtifactGraph; variables: VariableMap }
      >),
  })

type GdtCommandData = Parameters<typeof withDefaultGdtFrameDefaults>[0]['data']

const withGdtDefaults = <CommandName extends keyof ModelingCommandSchema>(
  add: AddCodemod<CommandName, { artifactGraph: ArtifactGraph }>,
  options?: ModelingCodemodOptions<CommandName>
) =>
  defineModelingCodemod<ModelingCommandSchema[CommandName]>({
    ...options,
    run: async ({ args, ast, kclManager, wasmInstance }) => {
      const data = await withDefaultGdtFrameDefaults({
        data: args as GdtCommandData,
        engineCommandManager: kclManager.engineCommandManager,
        ast,
        sourceCode: kclManager.code,
        outputUnit: kclManager.fileSettings.defaultLengthUnit,
        wasmInstance,
      })

      return add({
        ...data,
        ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance,
      } as unknown as AddCodemodArgs<
        CommandName,
        { artifactGraph: ArtifactGraph }
      >)
    },
  })

export const modelingCommandCodemods = {
  Extrude: withArtifactGraph<'Extrude'>(addExtrude, {
    enableExperimentalFeatures: (args) => Boolean(args.draftAngle),
  }),
  Sweep: withArtifactGraph<'Sweep'>(addSweep),
  Loft: withArtifactGraph<'Loft'>(addLoft),
  Revolve: withArtifactGraph<'Revolve'>(addRevolve),
  Shell: withArtifactGraph<'Shell'>(addShell),
  Hole: withArtifactGraph<'Hole'>(addHole),
  'Boolean Subtract': withArtifactGraph<'Boolean Subtract'>(addSubtract),
  'Boolean Union': withArtifactGraph<'Boolean Union'>(addUnion),
  'Boolean Intersect': withArtifactGraph<'Boolean Intersect'>(addIntersect),
  'Boolean Split': withArtifactGraph<'Boolean Split'>(addSplit),
  'Offset plane': withArtifactGraphAndVariables<'Offset plane'>(addOffsetPlane),
  Helix: withArtifactGraph<'Helix'>(addHelix),
  'Helical Gear': withAst<'Helical Gear'>(addHelicalGear, {
    enableExperimentalFeatures: true,
  }),
  'Herringbone Gear': withAst<'Herringbone Gear'>(addHerringboneGear, {
    enableExperimentalFeatures: true,
  }),
  'Spur Gear': withAst<'Spur Gear'>(addSpurGear, {
    enableExperimentalFeatures: true,
  }),
  'Ring Gear': withAst<'Ring Gear'>(addRingGear, {
    enableExperimentalFeatures: true,
  }),
  Fillet: withArtifactGraph<'Fillet'>(addFillet, {
    enableExperimentalFeatures: (args) => Boolean(args.version),
  }),
  Chamfer: withArtifactGraph<'Chamfer'>(addChamfer, {
    enableExperimentalFeatures: (args) => Boolean(args.version),
  }),
  Appearance: withArtifactGraph<'Appearance'>(addAppearance),
  Delete: withArtifactGraph<'Delete'>(addDelete, {
    enableExperimentalFeatures: true,
    focusPath: false,
  }),
  Translate: withArtifactGraph<'Translate'>(addTranslate),
  Rotate: withArtifactGraph<'Rotate'>(addRotate),
  Scale: withArtifactGraph<'Scale'>(addScale),
  Clone: withArtifactGraph<'Clone'>(addClone),
  'Mirror 3D': withArtifactGraphAndVariables<'Mirror 3D'>(addMirror3D),
  'Pattern Circular 3D':
    withArtifactGraph<'Pattern Circular 3D'>(addPatternCircular3D),
  'Pattern Linear 3D':
    withArtifactGraph<'Pattern Linear 3D'>(addPatternLinear3D),
  'GDT Flatness': withGdtDefaults<'GDT Flatness'>(addFlatnessGdt),
  'GDT Straightness': withGdtDefaults<'GDT Straightness'>(addStraightnessGdt),
  'GDT Circularity': withGdtDefaults<'GDT Circularity'>(addCircularityGdt),
  'GDT Cylindricity': withGdtDefaults<'GDT Cylindricity'>(addCylindricityGdt),
  'GDT Position': withGdtDefaults<'GDT Position'>(addPositionGdt),
  'GDT Profile': withGdtDefaults<'GDT Profile'>(addProfileGdt),
  'GDT Distance': withGdtDefaults<'GDT Distance'>(addDistanceGdt),
  'GDT Perpendicularity': withGdtDefaults<'GDT Perpendicularity'>(
    addPerpendicularityGdt
  ),
  'GDT Parallelism': withGdtDefaults<'GDT Parallelism'>(addParallelismGdt),
  'GDT Annotation': withGdtDefaults<'GDT Annotation'>(addAnnotationGdt),
  'GDT Datum': withGdtDefaults<'GDT Datum'>(addDatumGdt),
  'Flip Surface': withArtifactGraph<'Flip Surface'>(addFlipSurface),
  'Join Surfaces': withArtifactGraph<'Join Surfaces'>(addJoinSurfaces),
  'Delete Face': withArtifactGraph<'Delete Face'>(addDeleteFace),
  Blend: withArtifactGraph<'Blend'>(addBlend),
} satisfies ModelingCommandCodemods
