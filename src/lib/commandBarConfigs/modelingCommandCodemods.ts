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
import { isEnginePrimitiveSelection } from '@src/lib/selections'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

type ModelingCodemodCommandSchema = {
  [CommandName in keyof StdLibModelingCommandSchema]: StdLibModelingCommandSchema[CommandName] & {
    nodeToEdit?: PathToNode
  }
}

type ModelingCodemodCommandName = keyof ModelingCodemodCommandSchema &
  ModelingStdLibCommandName

type ModelingCommandCodemodConfig<
  CommandName extends ModelingCodemodCommandName,
> = ModelingCodemod<ModelingCodemodCommandSchema[CommandName]>

type ModelingCommandCodemods = Partial<{
  [CommandName in ModelingCodemodCommandName]: ModelingCommandCodemodConfig<CommandName>
}>

type AddCodemodArgs<
  CommandName extends ModelingCodemodCommandName,
  ExtraContext extends object = object,
> = ModelingCodemodCommandSchema[CommandName] &
  ExtraContext & {
    ast: Node<Program>
    wasmInstance: ModuleType
  }

type AddCodemod<
  CommandName extends ModelingCodemodCommandName,
  ExtraContext extends object = object,
> = (args: AddCodemodArgs<CommandName, ExtraContext>) => ModelingCodemodResult

type ModelingCodemodOptions<CommandName extends ModelingCodemodCommandName> =
  Omit<
    ModelingCommandCodemodConfig<CommandName>,
    'enableExperimentalFeatures' | 'run'
  >

const extrudeUsesEdgeProfile = (
  args: ModelingCodemodCommandSchema['Extrude']
) =>
  Boolean(
    args.sketches?.graphSelections.some(
      (selection) =>
        selection.artifact?.type === 'segment' ||
        selection.artifact?.type === 'sweepEdge' ||
        selection.artifact?.type === 'primitiveEdge'
    ) ||
      args.sketches?.otherSelections.some(
        (selection) =>
          isEnginePrimitiveSelection(selection) &&
          selection.primitiveType === 'edge'
      )
  )

const withStdLibExperimentalFeatures = <
  CommandName extends ModelingCodemodCommandName,
>(
  commandName: CommandName,
  options?: ModelingCodemodOptions<CommandName>
): Omit<ModelingCommandCodemodConfig<CommandName>, 'run'> => ({
  ...options,
  enableExperimentalFeatures: (args) =>
    modelingStdLibCommandUsesExperimentalFeatures(commandName, args),
})

const addCodemodArgs = <
  CommandName extends ModelingCodemodCommandName,
  ExtraContext extends object = object,
>(
  args: ModelingCodemodCommandSchema[CommandName],
  context: ExtraContext & {
    ast: Node<Program>
    wasmInstance: ModuleType
  }
): AddCodemodArgs<CommandName, ExtraContext> => ({
  ...args,
  ...context,
})

const withAst = <CommandName extends ModelingCodemodCommandName>(
  commandName: CommandName,
  add: AddCodemod<CommandName>,
  options?: ModelingCodemodOptions<CommandName>
) =>
  defineModelingCodemod<ModelingCodemodCommandSchema[CommandName]>({
    ...withStdLibExperimentalFeatures(commandName, options),
    run: ({ args, ast, wasmInstance }) =>
      add({
        ...args,
        ast,
        wasmInstance,
      }),
  })

const withArtifactGraph = <CommandName extends ModelingCodemodCommandName>(
  commandName: CommandName,
  add: AddCodemod<CommandName, { artifactGraph: ArtifactGraph }>,
  options?: ModelingCodemodOptions<CommandName>
) =>
  defineModelingCodemod<ModelingCodemodCommandSchema[CommandName]>({
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
  CommandName extends ModelingCodemodCommandName,
>(
  commandName: CommandName,
  add: AddCodemod<
    CommandName,
    { artifactGraph: ArtifactGraph; variables: VariableMap }
  >,
  options?: ModelingCodemodOptions<CommandName>
) =>
  defineModelingCodemod<ModelingCodemodCommandSchema[CommandName]>({
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

const withGdtDefaults = <CommandName extends ModelingCodemodCommandName>(
  commandName: CommandName,
  add: AddCodemod<CommandName, { artifactGraph: ArtifactGraph }>,
  options?: ModelingCodemodOptions<CommandName>
) =>
  defineModelingCodemod<ModelingCodemodCommandSchema[CommandName]>({
    ...withStdLibExperimentalFeatures(commandName, options),
    run: async ({ args, ast, kclManager, wasmInstance }) => {
      const data = await withDefaultGdtFrameDefaults({
        data: args as GdtCommandData,
        engineCommandManager: kclManager.engineCommandManager,
        ast,
        sourceCode: kclManager.code,
        outputUnit: kclManager.fileSettings.defaultLengthUnit,
        wasmInstance,
      })

      return add(
        addCodemodArgs(data as ModelingCodemodCommandSchema[CommandName], {
          ast,
          artifactGraph: kclManager.artifactGraph,
          wasmInstance,
        })
      )
    },
  })

export const modelingCommandCodemods = {
  Extrude: withArtifactGraph('Extrude', addExtrude, {
    // Surface edge extrudes make engine child-ID queries that mock execution cannot answer.
    skipMockExecution: extrudeUsesEdgeProfile,
  }),
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
  'GDT Distance': withGdtDefaults('GDT Distance', addDistanceGdt),
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
} satisfies ModelingCommandCodemods
