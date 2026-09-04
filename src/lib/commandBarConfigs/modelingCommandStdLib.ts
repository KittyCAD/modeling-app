import {
  STD_LIB_COMMANDS,
  type StdLibCommandArg,
  type StdLibCommandName,
} from '@src/lib/commandBarConfigs/modelingCommandStdLibCommands'
import type { StdLibModelingCommandSchema } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import type { CommandArgumentConfig } from '@src/lib/commandTypes'
import type { ModelingMachineContext } from '@src/machines/modelingSharedTypes'

type ModelingCommandName = Extract<keyof StdLibModelingCommandSchema, string>

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

export type StdLibCommandArgOverride = Partial<
  CommandArgumentConfig<unknown, ModelingMachineContext>
> &
  Record<string, unknown>

export type ModelingCommandArgOverrides<CommandArgs extends object> = Partial<{
  [ArgName in keyof CommandArgs]: Partial<
    CommandArgumentConfig<CommandArgs[ArgName], ModelingMachineContext>
  >
}>

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

type StdLibSemanticCommandArg = StdLibCommandArg & {
  readonly defaultValue?: { readonly source: string }
}

const stdLibArgInputType = (ty: StdLibCommandArg['ty']) => {
  if (ty === 'bool') {
    return 'boolean'
  }
  if (ty === 'TagDecl') {
    return 'tagDeclarator'
  }
  if (ty === 'Point2d' || ty === '[number(Length); 2]') {
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

function stdLibStringLiteralValue(source: string): string | undefined {
  const quote = source[0]
  if ((quote !== '"' && quote !== "'") || source.at(-1) !== quote) {
    return undefined
  }

  if (quote === '"') {
    try {
      const value: unknown = JSON.parse(source)
      return typeof value === 'string' ? value : undefined
    } catch {
      return undefined
    }
  }

  return source.slice(1, -1).replaceAll("\\'", "'").replaceAll('\\\\', '\\')
}

export type StdLibCommandArgDefaultValue = boolean | string

const stdLibArgDefaultValue = (
  arg: StdLibSemanticCommandArg
): StdLibCommandArgDefaultValue | undefined => {
  const source = arg.defaultValue?.source.trim()
  if (!source) {
    return undefined
  }

  if (arg.ty === 'bool') {
    if (source === 'true') {
      return true
    }
    if (source === 'false') {
      return false
    }
    return undefined
  }

  if (arg.ty === 'string') {
    return stdLibStringLiteralValue(source)
  }

  return source
}

export type StdLibCommandArgMetadata = Readonly<{
  name: string
  ty: StdLibCommandArg['ty']
  docs?: string
  required: boolean
  defaultValue?: StdLibCommandArgDefaultValue
}>

export type StdLibCommandArgName<Name extends StdLibCommandName> =
  (typeof STD_LIB_COMMANDS)[Name]['args'][number]['name']

/**
 * Returns UI-safe semantic metadata without constructing a command argument.
 * Boolean and string defaults are decoded; KCL expression defaults keep their
 * source text.
 */
export function stdLibCommandArgMetadata<Name extends StdLibCommandName>(
  stdLibName: Name,
  argName: StdLibCommandArgName<Name>
): StdLibCommandArgMetadata | undefined {
  const arg = STD_LIB_COMMANDS[stdLibName].args.find(
    (candidate) => candidate.name === argName
  )
  if (!arg) {
    return undefined
  }

  const defaultValue = stdLibArgDefaultValue(arg)
  return {
    name: arg.name,
    ty: arg.ty,
    required: arg.required,
    ...(arg.docs?.trim() ? { docs: arg.docs } : {}),
    ...(defaultValue === undefined ? {} : { defaultValue }),
  }
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

export function stdLibCommandSummary(
  stdLibName: StdLibCommandName
): string | undefined {
  const summary: string | undefined = STD_LIB_COMMANDS[stdLibName].summary
  return summary?.trim() ? summary : undefined
}

export const modelingCommandStdLibDriftConfig = {
  Extrude: {
    stdLibName: 'extrude',
    editFlow: true,
    flowArgOrder: [
      'sketches',
      'extentType',
      'directionMode',
      'length',
      'to',
      'bidirectionalLength',
      'bodyType',
      'method',
    ],
    uiOnlyArgs: ['extentType', 'directionMode'],
  },
  Sweep: {
    stdLibName: 'sweep',
    editFlow: true,
    flowArgOrder: [
      'sketches',
      'path',
      'profilePosition',
      'profileOrientation',
      'bodyType',
    ],
    uiOnlyArgs: ['profilePosition', 'profileOrientation'],
    deprecatedStdLibArgs: ['relativeTo'],
  },
  Loft: {
    stdLibName: 'loft',
    editFlow: true,
    flowArgOrder: ['sketches', 'bodyType'],
  },
  Revolve: {
    stdLibName: 'revolve',
    editFlow: true,
    flowArgOrder: [
      'sketches',
      'axisOrEdge',
      'axis',
      'edge',
      'extentType',
      'directionMode',
      'angle',
      'bidirectionalAngle',
      'bodyType',
    ],
    uiOnlyArgs: ['axisOrEdge', 'edge', 'extentType', 'directionMode'],
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
    omittedStdLibArgs: ['solid', 'edges'],
    argAliases: {
      tags: 'selection',
    },
  },
  Chamfer: {
    stdLibName: 'chamfer',
    editFlow: true,
    flowArgOrder: [
      'selection',
      'chamferType',
      'length',
      'secondLength',
      'angle',
    ],
    uiOnlyArgs: ['chamferType'],
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
    flowArgOrder: ['objects', 'x'],
  },
  Rotate: {
    stdLibName: 'rotate',
    editFlow: true,
    flowArgOrder: ['objects', 'axis', 'angle'],
  },
  Scale: {
    stdLibName: 'scale',
    editFlow: true,
    flowArgOrder: ['objects', 'factor'],
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
  },
  'Boolean Union': {
    stdLibName: 'union',
    flowArgOrder: ['solids'],
  },
  'Boolean Intersect': {
    stdLibName: 'intersect',
    flowArgOrder: ['solids'],
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
  },
} as const satisfies Partial<
  Record<ModelingCommandName, StdLibCommandDriftConfig>
>

export type ModelingStdLibCommandName =
  keyof typeof modelingCommandStdLibDriftConfig

/**
 * Command-palette copy that intentionally differs from the canonical KCL
 * summary. Keep these exceptions here rather than changing public KCL docs to
 * fit the command UI.
 */
const modelingCommandSummaryOverrides: Partial<
  Record<ModelingStdLibCommandName, string>
> = {
  Extrude: 'Pull a sketch into 3D along its normal or perpendicular.',
  Revolve: 'Create a 3D surface or solid by rotating a sketch around an axis.',
  Shell: 'Hollow out a 3D solid.',
  Hole: 'Cut a standard hole into a solid at a 2D position on one of its faces.',
  Fillet: 'Fillet edge',
  Chamfer: 'Create a straight bevel along one or more edges.',
  Helix: 'Create a helix or spiral in 3D about an axis.',
  'Helical Gear': 'Create a helical gear.',
  'Herringbone Gear': 'Create a herringbone gear.',
  'Spur Gear': 'Create a spur gear.',
  'Ring Gear': 'Create a ring gear.',
  Appearance:
    'Set the appearance of a solid. This only works on solids, not sketches or individual paths.',
  Delete: 'Delete selected bodies from the scene.',
  'Mirror 3D': 'Mirror solids across a plane or edge.',
  'Pattern Circular 3D':
    'Create a circular pattern of 3D solids around an axis.',
  'Pattern Linear 3D': 'Create a linear pattern of 3D solids along an axis.',
  'GDT Datum':
    'Add datum geometric dimensioning & tolerancing annotation to a face.',
  'GDT Profile':
    'Add profile geometric dimensioning & tolerancing annotation to faces or edges.',
  'Boolean Split':
    "Split a target body into two parts: the part that overlaps with the tool, and the part that doesn't.",
  'Delete Face': 'Delete a face from a body, leaving an open surface.',
  Blend: 'Blend two selected surface edges into a new surface.',
  'Join Surfaces': 'Join selected surfaces into one polysurface.',
}

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

/** Uses the concise KCL summary unless the command has product-specific copy. */
export function modelingStdLibCommandSummary(
  commandName: ModelingStdLibCommandName
) {
  return (
    modelingCommandSummaryOverrides[commandName] ??
    stdLibCommandSummary(modelingStdLibCommandName(commandName))
  )
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
