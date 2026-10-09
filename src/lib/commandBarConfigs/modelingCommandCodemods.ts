import { resolveDistanceSelections } from '@src/lib/gdtDistanceSelections'
import { getDimensionFunction } from '@src/lib/gdtDimension'
import { isErr } from '@src/lib/trap'
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
} from '@src/lang/modifyAst/gdt'
import {
  addHelicalGear,
  addHerringboneGear,
  addRingGear,
  addSpurGear,
} from '@src/lang/modifyAst/gears'
import { addHelix } from '@src/lang/modifyAst/geometry'
import {
  defineModelingCodemod,
  type ModelingCodemod,
  type ModelingCodemodResult,
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
import type {
  ArtifactGraph,
  PathToNode,
  Program,
  VariableMap,
} from '@src/lang/wasm'
import {
  type ModelingStdLibCommandName,
  modelingStdLibCommandUsesExperimentalFeatures,
} from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { StdLibModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import { withDefaultGdtFrameDefaults } from '@src/lib/gdtFramePosition'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

type CommandArgsByName = {
  [CommandName in keyof StdLibModelingCommandSchema]: StdLibModelingCommandSchema[CommandName] & {
    nodeToEdit?: PathToNode
  }
}

type CommandName = keyof CommandArgsByName & ModelingStdLibCommandName

type CommandCodemod<Name extends CommandName> = ModelingCodemod<
  CommandArgsByName[Name]
>

type CommandCodemods = Partial<{
  [Name in CommandName]: CommandCodemod<Name>
}>

type AddFunctionArgs<
  Name extends CommandName,
  ExtraContext extends object = object,
> = CommandArgsByName[Name] &
  ExtraContext & {
    ast: Node<Program>
    wasmInstance: ModuleType
  }

type AddFunction<
  Name extends CommandName,
  ExtraContext extends object = object,
> = (args: AddFunctionArgs<Name, ExtraContext>) => ModelingCodemodResult

type AddFunctionInput<Add extends (...args: never[]) => unknown> =
  Parameters<Add>[0]

// The following two `MissingCommandArgs` and `CompleteAddFunction` are the actual guard.
// Taking this for instance as a mini-Extrude example case.
//`
// type Expected = {
//   length: KclCommandValue
//   draftAngle?: KclCommandValue
// }
// ```
// Below we inspect the parameters explicitly:
// - `NoInfer` prevents this comparison from contributing to inference of `Add`.
// - `nodeToEdit` is excluded as it's specific command-bar plumbing for edits
// For an incomplete addExtrude input type, missing `draftAngle`,
// it would produce `'draftAngle'`.
type MissingCommandArgs<
  Name extends CommandName,
  Add extends (...args: never[]) => unknown,
> = Exclude<
  keyof CommandArgsByName[Name],
  keyof AddFunctionInput<NoInfer<Add>> | 'nodeToEdit'
>

// Then we require a `never` property for each missing argument.
// For our example, it would result in `typeof addExtrude & { draftAngle: never }`,
// so tsc fails because addExtrude has no required `draftAngle` property.
type CompleteAddFunction<
  Name extends CommandName,
  Add extends (...args: never[]) => unknown,
> = Add & Record<MissingCommandArgs<Name, Add>, never>

type CommandCodemodOptions<Name extends CommandName> = Omit<
  CommandCodemod<Name>,
  'enableExperimentalFeatures' | 'run'
>

const withStdLibExperimentalFeatures = <Name extends CommandName>(
  commandName: Name,
  options?: CommandCodemodOptions<Name>
): Omit<CommandCodemod<Name>, 'run'> => ({
  ...options,
  enableExperimentalFeatures: (args) =>
    modelingStdLibCommandUsesExperimentalFeatures(commandName, args),
})

const addCodemodArgs = <
  Name extends CommandName,
  ExtraContext extends object = object,
>(
  args: CommandArgsByName[Name],
  context: ExtraContext & {
    ast: Node<Program>
    wasmInstance: ModuleType
  }
): AddFunctionArgs<Name, ExtraContext> => ({
  ...args,
  ...context,
})

const withAst = <Name extends CommandName, Add extends AddFunction<Name>>(
  commandName: Name,
  add: CompleteAddFunction<Name, Add>,
  options?: CommandCodemodOptions<Name>
) =>
  defineModelingCodemod<CommandArgsByName[Name]>({
    ...withStdLibExperimentalFeatures(commandName, options),
    run: ({ args, ast, wasmInstance }) =>
      add({
        ...args,
        ast,
        wasmInstance,
      }),
  })

const withArtifactGraph = <
  Name extends CommandName,
  Add extends AddFunction<Name, { artifactGraph: ArtifactGraph }>,
>(
  commandName: Name,
  add: CompleteAddFunction<Name, Add>,
  options?: CommandCodemodOptions<Name>
) =>
  defineModelingCodemod<CommandArgsByName[Name]>({
    ...withStdLibExperimentalFeatures(commandName, options),
    run: ({ args, ast, kclManager, wasmInstance }) =>
      add(
        addCodemodArgs(args, {
          ast,
          artifactGraph: kclManager.artifactGraph,
          wasmInstance,
        })
      ),
  })

const withArtifactGraphAndVariables = <
  Name extends CommandName,
  Add extends AddFunction<
    Name,
    { artifactGraph: ArtifactGraph; variables: VariableMap }
  >,
>(
  commandName: Name,
  add: CompleteAddFunction<Name, Add>,
  options?: CommandCodemodOptions<Name>
) =>
  defineModelingCodemod<CommandArgsByName[Name]>({
    ...withStdLibExperimentalFeatures(commandName, options),
    run: ({ args, ast, kclManager, wasmInstance }) =>
      add(
        addCodemodArgs(args, {
          ast,
          artifactGraph: kclManager.artifactGraph,
          variables: kclManager.variables,
          wasmInstance,
        })
      ),
  })

type GdtCommandData = Parameters<typeof withDefaultGdtFrameDefaults>[0]['data']

const withGdtDefaults = <
  Name extends CommandName,
  Add extends AddFunction<Name, { artifactGraph: ArtifactGraph }>,
>(
  commandName: Name,
  add: CompleteAddFunction<Name, Add>,
  options?: CommandCodemodOptions<Name>
) =>
  defineModelingCodemod<CommandArgsByName[Name]>({
    ...withStdLibExperimentalFeatures(commandName, options),
    run: async ({ args, ast, kclManager, wasmInstance }) => {
      const data = await withDefaultGdtFrameDefaults({
        data: args as GdtCommandData,
        engineCommandManager: kclManager.engineCommandManager,
        ast,
        sourceCode: kclManager.code,
        outputUnit: kclManager.fileSettings.defaultLengthUnit,
        wasmInstance,
        distance: commandName === 'GDT Distance',
        artifactGraph: kclManager.artifactGraph,
      })

      return add(
        addCodemodArgs(data as CommandArgsByName[Name], {
          ast,
          artifactGraph: kclManager.artifactGraph,
          wasmInstance,
        })
      )
    },
  })

export const modelingCommandCodemods = {
  Extrude: withArtifactGraph('Extrude', addExtrude),
  Sweep: withArtifactGraph('Sweep', addSweep),
  Loft: withArtifactGraph('Loft', addLoft),
  Revolve: withArtifactGraph('Revolve', addRevolve),
  Shell: withArtifactGraph('Shell', addShell),
  Hole: withArtifactGraph('Hole', addHole),
  'Boolean Subtract': withArtifactGraph('Boolean Subtract', addSubtract),
  'Boolean Union': withArtifactGraph('Boolean Union', addUnion),
  'Boolean Intersect': withArtifactGraph('Boolean Intersect', addIntersect),
  'Boolean Split': withArtifactGraph('Boolean Split', addSplit),
  'Offset plane': withArtifactGraphAndVariables('Offset plane', addOffsetPlane),
  Helix: withArtifactGraph('Helix', addHelix),
  'Helical Gear': withAst('Helical Gear', addHelicalGear),
  'Herringbone Gear': withAst('Herringbone Gear', addHerringboneGear),
  'Spur Gear': withAst('Spur Gear', addSpurGear),
  'Ring Gear': withAst('Ring Gear', addRingGear),
  Fillet: withArtifactGraph('Fillet', addFillet),
  Chamfer: withArtifactGraph('Chamfer', addChamfer),
  Appearance: withArtifactGraph('Appearance', addAppearance),
  Delete: withArtifactGraph('Delete', addDelete, {
    focusPath: false,
  }),
  Translate: withArtifactGraph('Translate', addTranslate),
  Rotate: withArtifactGraph('Rotate', addRotate),
  Scale: withArtifactGraph('Scale', addScale),
  Clone: withArtifactGraph('Clone', addClone),
  'Mirror 3D': withArtifactGraphAndVariables('Mirror 3D', addMirror3D),
  'Pattern Circular 3D': withArtifactGraph(
    'Pattern Circular 3D',
    addPatternCircular3D
  ),
  'Pattern Linear 3D': withArtifactGraph(
    'Pattern Linear 3D',
    addPatternLinear3D
  ),
  'GDT Flatness': withGdtDefaults('GDT Flatness', addFlatnessGdt),
  'GDT Straightness': withGdtDefaults('GDT Straightness', addStraightnessGdt),
  'GDT Circularity': withGdtDefaults('GDT Circularity', addCircularityGdt),
  'GDT Cylindricity': withGdtDefaults('GDT Cylindricity', addCylindricityGdt),
  'GDT Position': withGdtDefaults('GDT Position', addPositionGdt),
  'GDT Profile': withGdtDefaults('GDT Profile', addProfileGdt),
  'GDT Distance': defineModelingCodemod<CommandArgsByName['GDT Distance']>({
    ...withStdLibExperimentalFeatures('GDT Distance'),
    run: async ({ args, ast, kclManager, wasmInstance }) => {
      const resolved = args.nodeToEdit
        ? {
            selections: args.objects ?? {
              graphSelections: [],
              otherSelections: [],
            },
            faces: new Map(),
          }
        : await resolveDistanceSelections(
            args.objects ?? { graphSelections: [], otherSelections: [] },
            kclManager.artifactGraph,
            kclManager.engineCommandManager
          )
      if (isErr(resolved)) return resolved
      const dimensionFunction = args.nodeToEdit
        ? (args.dimensionFunction ?? 'distance')
        : await getDimensionFunction(
            resolved.selections,
            kclManager.engineCommandManager
          )
      const data = await withDefaultGdtFrameDefaults({
        data: { ...args, objects: resolved.selections },
        ast,
        artifactGraph: kclManager.artifactGraph,
        engineCommandManager: kclManager.engineCommandManager,
        sourceCode: kclManager.code,
        outputUnit: kclManager.fileSettings.defaultLengthUnit,
        wasmInstance,
        distance: dimensionFunction === 'distance',
      })
      return addDistanceGdt({
        ...data,
        ast,
        artifactGraph: kclManager.artifactGraph,
        wasmInstance,
        edgeFaceSelections: resolved.faces,
        dimensionFunction,
      })
    },
  }),
  'GDT Perpendicularity': withGdtDefaults(
    'GDT Perpendicularity',
    addPerpendicularityGdt
  ),
  'GDT Angularity': withGdtDefaults('GDT Angularity', addAngularityGdt),
  'GDT Concentricity': withGdtDefaults(
    'GDT Concentricity',
    addConcentricityGdt
  ),
  'GDT Symmetry': withGdtDefaults('GDT Symmetry', addSymmetryGdt),
  'GDT Runout': withGdtDefaults('GDT Runout', addRunoutGdt),
  'GDT Parallelism': withGdtDefaults('GDT Parallelism', addParallelismGdt),
  'GDT Annotation': withGdtDefaults('GDT Annotation', addAnnotationGdt),
  'GDT Note': withAst('GDT Note', addNoteGdt),
  'GDT Datum': withGdtDefaults('GDT Datum', addDatumGdt),
  'Flip Surface': withArtifactGraph('Flip Surface', addFlipSurface),
  'Join Surfaces': withArtifactGraph('Join Surfaces', addJoinSurfaces),
  'Delete Face': withArtifactGraph('Delete Face', addDeleteFace),
  Blend: withArtifactGraph('Blend', addBlend),
} satisfies CommandCodemods
