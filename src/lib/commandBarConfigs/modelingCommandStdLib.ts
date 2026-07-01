import {
  STD_LIB_COMMANDS,
  type StdLibCommandArg,
  type StdLibCommandName,
} from '@src/lib/commandBarConfigs/modelingCommandStdLibCommands'

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
   * Deprecated KCL stdlib arguments intentionally still exposed by the command
   * bar for backwards-compatible point-and-click flows.
   */
  deprecatedStdLibArgs?: readonly string[]
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
   * Command-bar flow argument order from the legacy handwritten config.
   * This keeps prompt/test behavior stable when stdlib order differs. Flow
   * arguments are required, conditionally required, prepopulated, or otherwise
   * forced into the point-and-click flow.
   */
  flowArgOrder?: readonly string[]
}

type StdLibCommandArgOverride = Partial<
  CommandArgumentConfig<unknown, ModelingMachineContext>
> &
  Record<string, unknown>

type StdLibCommandArgsOptions = {
  omitted?: readonly string[]
  includeDeprecated?: readonly string[]
  argAliases?: Readonly<Record<string, string>>
  overrides?: Readonly<Record<string, StdLibCommandArgOverride>>
  includeEditFlowArgs?: boolean
  flowArgOrder?: readonly string[]
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

const isDeprecatedStdLibArg = (arg: StdLibCommandArg) =>
  arg.deprecated || arg.deprecatedSince !== null

const stdLibArgDeprecatedMessage = (arg: StdLibCommandArg) => {
  if (!isDeprecatedStdLibArg(arg)) {
    return undefined
  }

  return [
    arg.deprecatedSince === null
      ? 'Deprecated.'
      : `Deprecated as of KCL ${arg.deprecatedSince}.`,
    arg.docs?.trim(),
  ]
    .filter(Boolean)
    .join(' ')
}

const hasExistingEditFlowArgument = (
  context: { argumentsToSubmit: Record<string, unknown> },
  argName: string
) =>
  Boolean(context.argumentsToSubmit.nodeToEdit) &&
  context.argumentsToSubmit[argName] !== undefined

const stdLibArgBaseConfig = (
  arg: StdLibCommandArg,
  commandArgName: string
) => ({
  inputType: stdLibArgInputType(arg.ty),
  required: arg.required,
  ...(arg.experimental
    ? ({ status: 'experimental' } as const)
    : isDeprecatedStdLibArg(arg)
      ? ({
          status: 'deprecated',
          statusMessage: stdLibArgDeprecatedMessage(arg),
          hidden: (context: { argumentsToSubmit: Record<string, unknown> }) =>
            !hasExistingEditFlowArgument(context, commandArgName),
        } as const)
      : {}),
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

function orderCommandArgs(
  args: Record<string, Record<string, unknown>>,
  flowArgOrder: readonly string[] = []
) {
  if (flowArgOrder.length === 0) {
    return args
  }

  const orderedArgs: Record<string, Record<string, unknown>> = {}
  for (const argName of flowArgOrder) {
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
  const includeDeprecated = new Set(options.includeDeprecated ?? [])
  const args: Record<string, Record<string, unknown>> = Object.fromEntries(
    STD_LIB_COMMANDS[stdLibName].args
      .filter(
        (arg) => !isDeprecatedStdLibArg(arg) || includeDeprecated.has(arg.name)
      )
      .filter((arg) => !omitted.has(arg.name))
      .map((arg) => {
        const commandArgName = options.argAliases?.[arg.name] ?? arg.name
        return [
          commandArgName,
          {
            ...stdLibArgBaseConfig(arg, commandArgName),
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

  return orderCommandArgs(
    args,
    options.flowArgOrder
  ) as CommandArgConfigs<CommandArgs>
}

export const modelingCommandStdLibDriftConfig = {
  Extrude: {
    stdLibName: 'extrude',
    editFlow: true,
    flowArgOrder: ['sketches', 'length', 'bodyType'],
    omittedStdLibArgs: ['direction'],
  },
  Sweep: {
    stdLibName: 'sweep',
    editFlow: true,
    flowArgOrder: ['sketches', 'path', 'bodyType'],
    deprecatedStdLibArgs: ['relativeTo'],
    omittedStdLibArgs: ['tolerance'],
  },
  Loft: {
    stdLibName: 'loft',
    editFlow: true,
    flowArgOrder: ['sketches', 'bodyType'],
    omittedStdLibArgs: ['tolerance'],
  },
  Revolve: {
    stdLibName: 'revolve',
    editFlow: true,
    flowArgOrder: [
      'sketches',
      'axisOrEdge',
      'axis',
      'edge',
      'angle',
      'bodyType',
    ],
    uiOnlyArgs: ['axisOrEdge', 'edge'],
    omittedStdLibArgs: ['tolerance'],
  },
  Shell: {
    stdLibName: 'shell',
    editFlow: true,
    flowArgOrder: ['faces', 'thickness'],
    omittedStdLibArgs: ['solids'],
  },
  Hole: {
    stdLibName: 'hole::hole',
    editFlow: true,
    flowArgOrder: [
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
    flowArgOrder: ['selection', 'radius'],
    omittedStdLibArgs: ['solid', 'edges', 'tolerance'],
    argAliases: {
      tags: 'selection',
    },
  },
  Chamfer: {
    stdLibName: 'chamfer',
    editFlow: true,
    flowArgOrder: ['selection', 'length'],
    omittedStdLibArgs: ['solid', 'edges'],
    argAliases: {
      tags: 'selection',
    },
  },
  'Offset plane': {
    stdLibName: 'offsetPlane',
    editFlow: true,
    flowArgOrder: ['plane', 'offset'],
  },
  Helix: {
    stdLibName: 'helix',
    editFlow: true,
    flowArgOrder: [
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
    flowArgOrder: [
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
    flowArgOrder: [
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
    flowArgOrder: ['nTeeth', 'module', 'pressureAngle', 'gearHeight'],
  },
  'Ring Gear': {
    stdLibName: 'gear::ring',
    editFlow: true,
    flowArgOrder: [
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
    flowArgOrder: ['objects', 'color'],
    argAliases: {
      solids: 'objects',
    },
  },
  Translate: {
    stdLibName: 'translate',
    editFlow: true,
    flowArgOrder: ['objects'],
    omittedStdLibArgs: ['xyz'],
  },
  Rotate: {
    stdLibName: 'rotate',
    editFlow: true,
    flowArgOrder: ['objects'],
    omittedStdLibArgs: ['axis', 'angle'],
  },
  Scale: {
    stdLibName: 'scale',
    editFlow: true,
    flowArgOrder: ['objects'],
  },
  Clone: {
    stdLibName: 'clone',
    editFlow: true,
    flowArgOrder: ['objects', 'variableName'],
    uiOnlyArgs: ['variableName'],
    argAliases: {
      geometries: 'objects',
    },
  },
  Delete: {
    stdLibName: 'delete',
    flowArgOrder: ['objects'],
  },
  'Mirror 3D': {
    stdLibName: 'mirror3d',
    flowArgOrder: ['bodies', 'across'],
  },
  'Pattern Circular 3D': {
    stdLibName: 'patternCircular3d',
    editFlow: true,
    flowArgOrder: ['solids', 'instances', 'axis', 'center'],
  },
  'Pattern Linear 3D': {
    stdLibName: 'patternLinear3d',
    editFlow: true,
    flowArgOrder: ['solids', 'instances', 'distance', 'axis'],
  },
  'GDT Flatness': {
    stdLibName: 'gdt::flatness',
    editFlow: true,
    flowArgOrder: ['faces', 'tolerance'],
  },
  'GDT Straightness': {
    stdLibName: 'gdt::straightness',
    editFlow: true,
    flowArgOrder: ['objects', 'tolerance'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Circularity': {
    stdLibName: 'gdt::circularity',
    editFlow: true,
    flowArgOrder: ['objects', 'tolerance'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Cylindricity': {
    stdLibName: 'gdt::cylindricity',
    editFlow: true,
    flowArgOrder: ['objects', 'tolerance'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Datum': {
    stdLibName: 'gdt::datum',
    editFlow: true,
    flowArgOrder: ['faces', 'name'],
    argAliases: {
      face: 'faces',
    },
  },
  'GDT Position': {
    stdLibName: 'gdt::position',
    editFlow: true,
    flowArgOrder: ['objects', 'tolerance'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Profile': {
    stdLibName: 'gdt::profileLine',
    editFlow: true,
    flowArgOrder: ['objects', 'tolerance'],
    argAliases: {
      edges: 'objects',
    },
  },
  'GDT Distance': {
    stdLibName: 'gdt::distance',
    editFlow: true,
    flowArgOrder: ['objects', 'tolerance'],
    argAliases: {
      from: 'objects',
      to: 'objects',
      edges: 'objects',
    },
  },
  'GDT Perpendicularity': {
    stdLibName: 'gdt::perpendicularity',
    editFlow: true,
    flowArgOrder: ['objects', 'tolerance'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Angularity': {
    stdLibName: 'gdt::angularity',
    editFlow: true,
    flowArgOrder: ['objects', 'tolerance'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Concentricity': {
    stdLibName: 'gdt::concentricity',
    editFlow: true,
    flowArgOrder: ['objects', 'datums', 'tolerance'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Symmetry': {
    stdLibName: 'gdt::symmetry',
    editFlow: true,
    flowArgOrder: ['objects', 'datums', 'tolerance'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Runout': {
    stdLibName: 'gdt::runout',
    editFlow: true,
    flowArgOrder: ['objects', 'datums', 'tolerance'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Parallelism': {
    stdLibName: 'gdt::parallelism',
    editFlow: true,
    flowArgOrder: ['objects', 'tolerance'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Annotation': {
    stdLibName: 'gdt::annotation',
    editFlow: true,
    flowArgOrder: ['objects', 'annotation'],
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Note': {
    stdLibName: 'gdt::note',
    editFlow: true,
    flowArgOrder: ['note'],
  },
  'Boolean Subtract': {
    stdLibName: 'subtract',
    flowArgOrder: ['solids', 'tools'],
    omittedStdLibArgs: ['tolerance'],
  },
  'Boolean Union': {
    stdLibName: 'union',
    flowArgOrder: ['solids'],
    omittedStdLibArgs: ['tolerance'],
  },
  'Boolean Intersect': {
    stdLibName: 'intersect',
    flowArgOrder: ['solids'],
    omittedStdLibArgs: ['tolerance'],
  },
  'Boolean Split': {
    stdLibName: 'split',
    editFlow: true,
    flowArgOrder: ['targets'],
  },
  'Flip Surface': {
    stdLibName: 'flipSurface',
    flowArgOrder: ['surface'],
  },
  'Delete Face': {
    stdLibName: 'deleteFace',
    flowArgOrder: ['faces'],
    omittedStdLibArgs: ['body', 'faceIndices'],
  },
  Blend: {
    stdLibName: 'blend',
    flowArgOrder: ['edges'],
  },
  'Join Surfaces': {
    stdLibName: 'joinSurfaces',
    flowArgOrder: ['selection'],
    omittedStdLibArgs: ['tolerance'],
  },
} as const satisfies Partial<
  Record<ModelingCommandName, StdLibCommandDriftConfig>
>

export type ModelingStdLibCommandName =
  keyof typeof modelingCommandStdLibDriftConfig

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
    includeDeprecated: driftConfig.deprecatedStdLibArgs,
    argAliases: driftConfig.argAliases,
    overrides: options.overrides,
    includeEditFlowArgs: driftConfig.editFlow,
    flowArgOrder: driftConfig.flowArgOrder,
  })
}

export function stdLibCommandStatus(stdLibName: StdLibCommandName) {
  const stdLibCommand = STD_LIB_COMMANDS[stdLibName]

  if (stdLibCommand.experimental) {
    return 'experimental' as const
  }
  if (stdLibCommand.deprecated || stdLibCommand.deprecatedSince !== null) {
    return 'deprecated' as const
  }
  return undefined
}

export function modelingStdLibCommandStatus(
  commandName: keyof typeof modelingCommandStdLibDriftConfig
) {
  const driftConfig = modelingCommandStdLibDriftConfig[
    commandName
  ] as StdLibCommandDriftConfig

  return stdLibCommandStatus(driftConfig.stdLibName)
}

export function modelingStdLibCommandUsesExperimentalFeatures(
  commandName: ModelingStdLibCommandName,
  commandArgs: Record<string, unknown>
) {
  const driftConfig = modelingCommandStdLibDriftConfig[
    commandName
  ] as StdLibCommandDriftConfig
  const stdLibCommand = STD_LIB_COMMANDS[driftConfig.stdLibName]

  if (stdLibCommand.experimental) {
    return true
  }

  const omittedStdLibArgs = new Set(driftConfig.omittedStdLibArgs ?? [])
  return stdLibCommand.args.some((arg) => {
    if (!arg.experimental || omittedStdLibArgs.has(arg.name)) {
      return false
    }

    const commandArgName = driftConfig.argAliases?.[arg.name] ?? arg.name
    return commandArgs[commandArgName] !== undefined
  })
}
