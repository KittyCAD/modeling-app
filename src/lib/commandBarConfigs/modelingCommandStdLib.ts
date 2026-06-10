import {
  STD_LIB_COMMANDS,
  type StdLibCommandArg,
  type StdLibCommandName,
} from '@rust/kcl-lib/bindings/StdLibCommands'

import type { ModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandConfig'
import type { CommandArgumentConfig } from '@src/lib/commandTypes'
import type { ModelingMachineContext } from '@src/machines/modelingSharedTypes'

type ModelingCommandName = Extract<keyof ModelingCommandSchema, string>

export type StdLibCommandDriftConfig = {
  stdLibName: StdLibCommandName
  /**
   * Additional command-bar arguments that are not KCL stdlib arguments. These
   * usually split one KCL value into easier UI inputs.
   */
  uiOnlyArgs?: readonly string[]
  /**
   * KCL stdlib arguments intentionally not exposed by the command bar.
   */
  omittedStdLibArgs?: readonly string[]
  /**
   * KCL stdlib argument names that are exposed under a different command-bar
   * argument name.
   */
  argAliases?: Readonly<Record<string, string>>
  /**
   * The command supports editing an existing stdlib call from the AST.
   */
  editFlow?: boolean
  /**
   * Required command-bar argument key order from the legacy handwritten config.
   * This keeps prompt/test behavior stable when stdlib order differs.
   */
  requiredArgOrder?: readonly string[]
}

type StdLibCommandArgOverride = Partial<
  CommandArgumentConfig<unknown, ModelingMachineContext>
> &
  Record<string, unknown>

type StdLibCommandArgsOptions = {
  omitted?: readonly string[]
  argAliases?: Readonly<Record<string, string>>
  overrides?: Readonly<Record<string, StdLibCommandArgOverride>>
  includeEditFlowArgs?: boolean
  requiredArgOrder?: readonly string[]
}

type CommandArgConfigs<CommandArgs extends object> = {
  [ArgName in keyof CommandArgs]-?: CommandArgumentConfig<
    CommandArgs[ArgName],
    ModelingMachineContext
  >
}

const stdLibArgInputType = (ty: StdLibCommandArg['ty']) => {
  if (ty === 'bool') {
    return 'boolean'
  }
  if (ty === 'TagDecl') {
    return 'tagDeclarator'
  }
  if (ty === 'Point2d') {
    return 'vector2d'
  }
  if (ty === 'Point3d') {
    return 'vector3d'
  }
  if (ty === 'string') {
    return 'string'
  }
  return 'kcl'
}

const stdLibArgBaseConfig = (arg: StdLibCommandArg) => ({
  inputType: stdLibArgInputType(arg.ty),
  required: arg.required,
  ...(arg.experimental ? ({ status: 'experimental' } as const) : {}),
})

const commandBarEditFlowArgs: Record<string, StdLibCommandArgOverride> = {
  nodeToEdit: {
    description:
      'Path to the node in the AST to edit. Never shown to the user.',
    inputType: 'text',
    required: false,
    hidden: true,
  },
}

function orderRequiredCommandArgs(
  args: Record<string, Record<string, unknown>>,
  requiredArgOrder: readonly string[] = []
) {
  if (requiredArgOrder.length === 0) {
    return args
  }

  const orderedArgs: Record<string, Record<string, unknown>> = {}
  for (const argName of requiredArgOrder) {
    if (argName in args) {
      orderedArgs[argName] = args[argName]
    }
  }

  for (const [argName, arg] of Object.entries(args)) {
    orderedArgs[argName] ??= arg
  }

  return orderedArgs
}

export function stdLibCommandArgs<CommandArgs extends object>(
  stdLibName: StdLibCommandName,
  options: StdLibCommandArgsOptions = {}
): CommandArgConfigs<CommandArgs> {
  const omitted = new Set(options.omitted ?? [])
  const args: Record<string, Record<string, unknown>> = Object.fromEntries(
    STD_LIB_COMMANDS[stdLibName].args
      .filter((arg) => arg.deprecatedSince === null)
      .filter((arg) => !omitted.has(arg.name))
      .map((arg) => {
        const commandArgName = options.argAliases?.[arg.name] ?? arg.name
        return [
          commandArgName,
          {
            ...stdLibArgBaseConfig(arg),
            ...(options.overrides?.[commandArgName] ?? {}),
          },
        ]
      })
  )

  for (const [argName, override] of Object.entries(options.overrides ?? {})) {
    args[argName] ??= override
  }

  if (options.includeEditFlowArgs) {
    for (const [argName, arg] of Object.entries(commandBarEditFlowArgs)) {
      args[argName] ??= arg
    }
  }

  return orderRequiredCommandArgs(
    args,
    options.requiredArgOrder
  ) as CommandArgConfigs<CommandArgs>
}

export const modelingCommandStdLibDriftConfig = {
  Extrude: {
    stdLibName: 'extrude',
    editFlow: true,
    requiredArgOrder: ['sketches'],
    omittedStdLibArgs: ['direction'],
  },
  Sweep: {
    stdLibName: 'sweep',
    editFlow: true,
    requiredArgOrder: ['sketches', 'path'],
    omittedStdLibArgs: ['tolerance', 'version'],
  },
  Loft: {
    stdLibName: 'loft',
    editFlow: true,
    requiredArgOrder: ['sketches'],
    omittedStdLibArgs: ['tolerance'],
  },
  Revolve: {
    stdLibName: 'revolve',
    editFlow: true,
    requiredArgOrder: ['sketches', 'axisOrEdge', 'axis', 'edge', 'angle'],
    uiOnlyArgs: ['axisOrEdge', 'edge'],
    omittedStdLibArgs: ['tolerance'],
  },
  Shell: {
    stdLibName: 'shell',
    editFlow: true,
    requiredArgOrder: ['faces', 'thickness'],
    omittedStdLibArgs: ['solids'],
  },
  Hole: {
    stdLibName: 'hole::hole',
    editFlow: true,
    requiredArgOrder: [
      'face',
      'cutAt',
      'holeBody',
      'blindDepth',
      'blindDiameter',
      'holeType',
      'counterboreDepth',
      'counterboreDiameter',
      'countersinkAngle',
      'countersinkDiameter',
      'holeBottom',
      'drillPointAngle',
    ],
    uiOnlyArgs: [
      'blindDepth',
      'blindDiameter',
      'counterboreDepth',
      'counterboreDiameter',
      'countersinkAngle',
      'countersinkDiameter',
      'countersinkHeadClearance',
      'drillPointAngle',
    ],
    omittedStdLibArgs: ['solid'],
  },
  Fillet: {
    stdLibName: 'fillet',
    editFlow: true,
    requiredArgOrder: ['selection', 'radius'],
    omittedStdLibArgs: ['solid', 'tolerance'],
    argAliases: {
      tags: 'selection',
    },
  },
  Chamfer: {
    stdLibName: 'chamfer',
    editFlow: true,
    requiredArgOrder: ['selection', 'length'],
    omittedStdLibArgs: ['solid'],
    argAliases: {
      tags: 'selection',
    },
  },
  'Offset plane': {
    stdLibName: 'offsetPlane',
    editFlow: true,
    requiredArgOrder: ['plane', 'offset'],
  },
  Helix: {
    stdLibName: 'helix',
    editFlow: true,
    requiredArgOrder: [
      'mode',
      'axis',
      'edge',
      'cylinder',
      'revolutions',
      'angleStart',
      'radius',
      'length',
    ],
    uiOnlyArgs: ['mode', 'edge'],
  },
  'Helical Gear': {
    stdLibName: 'gear::helical',
    editFlow: true,
    requiredArgOrder: [
      'nTeeth',
      'module',
      'pressureAngle',
      'helixAngle',
      'gearHeight',
    ],
  },
  'Herringbone Gear': {
    stdLibName: 'gear::herringbone',
    editFlow: true,
    requiredArgOrder: [
      'nTeeth',
      'module',
      'pressureAngle',
      'gearHeight',
      'helixAngle',
    ],
  },
  'Spur Gear': {
    stdLibName: 'gear::spur',
    editFlow: true,
    requiredArgOrder: ['nTeeth', 'module', 'pressureAngle', 'gearHeight'],
  },
  'Ring Gear': {
    stdLibName: 'gear::ring',
    editFlow: true,
    requiredArgOrder: [
      'nTeeth',
      'module',
      'pressureAngle',
      'helixAngle',
      'gearHeight',
    ],
  },
  Appearance: {
    stdLibName: 'appearance',
    editFlow: true,
    requiredArgOrder: ['objects', 'color'],
    argAliases: {
      solids: 'objects',
    },
  },
  Translate: {
    stdLibName: 'translate',
    editFlow: true,
    requiredArgOrder: ['objects'],
    omittedStdLibArgs: ['xyz'],
  },
  Rotate: {
    stdLibName: 'rotate',
    editFlow: true,
    requiredArgOrder: ['objects'],
    omittedStdLibArgs: ['axis', 'angle'],
  },
  Scale: {
    stdLibName: 'scale',
    editFlow: true,
    requiredArgOrder: ['objects'],
  },
  Clone: {
    stdLibName: 'clone',
    editFlow: true,
    requiredArgOrder: ['objects', 'variableName'],
    uiOnlyArgs: ['variableName'],
    argAliases: {
      geometries: 'objects',
    },
  },
  Delete: {
    stdLibName: 'delete',
    requiredArgOrder: ['objects'],
  },
  'Mirror 3D': {
    stdLibName: 'mirror3d',
    requiredArgOrder: ['bodies', 'across'],
  },
  'Pattern Circular 3D': {
    stdLibName: 'patternCircular3d',
    editFlow: true,
    requiredArgOrder: ['solids', 'instances', 'axis'],
  },
  'Pattern Linear 3D': {
    stdLibName: 'patternLinear3d',
    editFlow: true,
    requiredArgOrder: ['solids', 'instances', 'distance', 'axis'],
  },
  'GDT Flatness': {
    stdLibName: 'gdt::flatness',
    editFlow: true,
    requiredArgOrder: ['faces', 'tolerance'],
  },
  'GDT Straightness': {
    stdLibName: 'gdt::straightness',
    editFlow: true,
    requiredArgOrder: ['objects', 'tolerance'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Circularity': {
    stdLibName: 'gdt::circularity',
    editFlow: true,
    requiredArgOrder: ['objects', 'tolerance'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Cylindricity': {
    stdLibName: 'gdt::cylindricity',
    editFlow: true,
    requiredArgOrder: ['objects', 'tolerance'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Datum': {
    stdLibName: 'gdt::datum',
    editFlow: true,
    requiredArgOrder: ['faces', 'name'],
    argAliases: {
      face: 'faces',
    },
  },
  'GDT Position': {
    stdLibName: 'gdt::position',
    editFlow: true,
    requiredArgOrder: ['objects', 'tolerance'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Profile': {
    stdLibName: 'gdt::profile',
    editFlow: true,
    requiredArgOrder: ['edges', 'tolerance'],
  },
  'GDT Distance': {
    stdLibName: 'gdt::distance',
    editFlow: true,
    requiredArgOrder: ['objects', 'tolerance'],
    argAliases: {
      from: 'objects',
      to: 'objects',
      edges: 'objects',
    },
  },
  'GDT Perpendicularity': {
    stdLibName: 'gdt::perpendicularity',
    editFlow: true,
    requiredArgOrder: ['objects', 'tolerance'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Angularity': {
    stdLibName: 'gdt::angularity',
    editFlow: true,
    requiredArgOrder: ['objects', 'tolerance'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Parallelism': {
    stdLibName: 'gdt::parallelism',
    editFlow: true,
    requiredArgOrder: ['objects', 'tolerance'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Annotation': {
    stdLibName: 'gdt::annotation',
    editFlow: true,
    requiredArgOrder: ['objects', 'annotation'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'Boolean Subtract': {
    stdLibName: 'subtract',
    requiredArgOrder: ['solids', 'tools'],
    omittedStdLibArgs: ['tolerance'],
  },
  'Boolean Union': {
    stdLibName: 'union',
    requiredArgOrder: ['solids'],
    omittedStdLibArgs: ['tolerance'],
  },
  'Boolean Intersect': {
    stdLibName: 'intersect',
    requiredArgOrder: ['solids'],
    omittedStdLibArgs: ['tolerance'],
  },
  'Boolean Split': {
    stdLibName: 'split',
    editFlow: true,
    requiredArgOrder: ['targets'],
  },
  'Flip Surface': {
    stdLibName: 'flipSurface',
    requiredArgOrder: ['surface'],
  },
  'Delete Face': {
    stdLibName: 'deleteFace',
    requiredArgOrder: ['faces'],
    omittedStdLibArgs: ['body', 'faceIndices'],
  },
  Blend: {
    stdLibName: 'blend',
    requiredArgOrder: ['edges'],
  },
  'Join Surfaces': {
    stdLibName: 'joinSurfaces',
    requiredArgOrder: ['selection'],
    omittedStdLibArgs: ['tolerance'],
  },
} as const satisfies Partial<
  Record<ModelingCommandName, StdLibCommandDriftConfig>
>

export function modelingStdLibCommandName<
  CommandName extends keyof typeof modelingCommandStdLibDriftConfig,
>(
  commandName: CommandName
): (typeof modelingCommandStdLibDriftConfig)[CommandName]['stdLibName'] {
  return modelingCommandStdLibDriftConfig[commandName].stdLibName
}

export function modelingStdLibCall(
  commandName: keyof typeof modelingCommandStdLibDriftConfig
): { name: string; path: string[] } {
  const stdLibName = modelingStdLibCommandName(commandName)
  const parts = stdLibName.split('::')
  const name = parts.pop() ?? stdLibName

  return { name, path: parts }
}

export function modelingStdLibCommandArgs<CommandArgs extends object>(
  commandName: keyof typeof modelingCommandStdLibDriftConfig,
  options: Pick<StdLibCommandArgsOptions, 'overrides'> = {}
) {
  const driftConfig = modelingCommandStdLibDriftConfig[
    commandName
  ] as StdLibCommandDriftConfig

  return stdLibCommandArgs<CommandArgs>(driftConfig.stdLibName, {
    omitted: driftConfig.omittedStdLibArgs,
    argAliases: driftConfig.argAliases,
    overrides: options.overrides,
    includeEditFlowArgs: driftConfig.editFlow,
    requiredArgOrder: driftConfig.requiredArgOrder,
  })
}

export function modelingStdLibCommandStatus(
  commandName: keyof typeof modelingCommandStdLibDriftConfig
) {
  const driftConfig = modelingCommandStdLibDriftConfig[
    commandName
  ] as StdLibCommandDriftConfig

  return STD_LIB_COMMANDS[driftConfig.stdLibName].experimental
    ? ('experimental' as const)
    : undefined
}
