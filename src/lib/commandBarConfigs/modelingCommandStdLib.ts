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
}

type StdLibCommandArgOverride = Partial<
  CommandArgumentConfig<unknown, ModelingMachineContext>
> &
  Record<string, unknown>

type StdLibCommandArgsOptions = {
  omitted?: readonly string[]
  argAliases?: Readonly<Record<string, string>>
  overrides?: Readonly<Record<string, StdLibCommandArgOverride>>
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

  return args as CommandArgConfigs<CommandArgs>
}

export const modelingCommandStdLibDriftConfig = {
  Extrude: {
    stdLibName: 'extrude',
    omittedStdLibArgs: ['direction'],
  },
  Sweep: {
    stdLibName: 'sweep',
    omittedStdLibArgs: ['tolerance', 'version'],
  },
  Loft: {
    stdLibName: 'loft',
    omittedStdLibArgs: ['tolerance'],
  },
  Revolve: {
    stdLibName: 'revolve',
    uiOnlyArgs: ['axisOrEdge', 'edge'],
    omittedStdLibArgs: ['tolerance'],
  },
  Shell: {
    stdLibName: 'shell',
    omittedStdLibArgs: ['solids'],
  },
  Hole: {
    stdLibName: 'hole::hole',
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
    omittedStdLibArgs: ['solid', 'tolerance'],
    argAliases: {
      tags: 'selection',
    },
  },
  Chamfer: {
    stdLibName: 'chamfer',
    omittedStdLibArgs: ['solid'],
    argAliases: {
      tags: 'selection',
    },
  },
  'Offset plane': {
    stdLibName: 'offsetPlane',
  },
  Helix: {
    stdLibName: 'helix',
    uiOnlyArgs: ['mode', 'edge'],
  },
  'Helical Gear': {
    stdLibName: 'gear::helical',
  },
  'Herringbone Gear': {
    stdLibName: 'gear::herringbone',
  },
  'Spur Gear': {
    stdLibName: 'gear::spur',
  },
  'Ring Gear': {
    stdLibName: 'gear::ring',
  },
  Appearance: {
    stdLibName: 'appearance',
    argAliases: {
      solids: 'objects',
    },
  },
  Translate: {
    stdLibName: 'translate',
    omittedStdLibArgs: ['xyz'],
  },
  Rotate: {
    stdLibName: 'rotate',
    omittedStdLibArgs: ['axis', 'angle'],
  },
  Scale: {
    stdLibName: 'scale',
  },
  Clone: {
    stdLibName: 'clone',
    uiOnlyArgs: ['variableName'],
    argAliases: {
      geometries: 'objects',
    },
  },
  Delete: {
    stdLibName: 'delete',
  },
  'Mirror 3D': {
    stdLibName: 'mirror3d',
  },
  'Pattern Circular 3D': {
    stdLibName: 'patternCircular3d',
  },
  'Pattern Linear 3D': {
    stdLibName: 'patternLinear3d',
  },
  'GDT Flatness': {
    stdLibName: 'gdt::flatness',
  },
  'GDT Straightness': {
    stdLibName: 'gdt::straightness',
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Circularity': {
    stdLibName: 'gdt::circularity',
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Cylindricity': {
    stdLibName: 'gdt::cylindricity',
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Datum': {
    stdLibName: 'gdt::datum',
    argAliases: {
      face: 'faces',
    },
  },
  'GDT Position': {
    stdLibName: 'gdt::position',
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Profile': {
    stdLibName: 'gdt::profile',
  },
  'GDT Distance': {
    stdLibName: 'gdt::distance',
    argAliases: {
      from: 'objects',
      to: 'objects',
      edges: 'objects',
    },
  },
  'GDT Perpendicularity': {
    stdLibName: 'gdt::perpendicularity',
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Parallelism': {
    stdLibName: 'gdt::parallelism',
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'GDT Annotation': {
    stdLibName: 'gdt::annotation',
    argAliases: {
      faces: 'objects',
      edges: 'objects',
    },
  },
  'Boolean Subtract': {
    stdLibName: 'subtract',
    omittedStdLibArgs: ['tolerance'],
  },
  'Boolean Union': {
    stdLibName: 'union',
    omittedStdLibArgs: ['tolerance'],
  },
  'Boolean Intersect': {
    stdLibName: 'intersect',
    omittedStdLibArgs: ['tolerance'],
  },
  'Boolean Split': {
    stdLibName: 'split',
  },
  'Flip Surface': {
    stdLibName: 'flipSurface',
  },
  'Delete Face': {
    stdLibName: 'deleteFace',
    omittedStdLibArgs: ['body', 'faceIndices'],
  },
  Blend: {
    stdLibName: 'blend',
  },
  'Join Surfaces': {
    stdLibName: 'joinSurfaces',
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
