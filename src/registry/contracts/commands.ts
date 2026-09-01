import {
  appendValueSpec,
  defineContract,
  defineService,
  defineValueSpec,
  provide,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { Command } from '@src/lib/commandTypes'
import { commandKey } from '@src/lib/commandUtils'
import type { CommandBarActorType } from '@src/machines/commandBarMachine'
import type { SnapshotFrom } from 'xstate'

export { commandKey } from '@src/lib/commandUtils'

export const BASE_COMMAND_SCOPE = 'base'
export const CODE_EDITOR_FOCUSED_COMMAND_SCOPE = 'code-editor-focused'
export const CODE_EDITOR_NOT_FOCUSED_COMMAND_SCOPE = 'code-editor-not-focused'
export const MODE_MODELING_COMMAND_SCOPE = 'mode-modeling'
export const MODE_SKETCHING_COMMAND_SCOPE = 'mode-sketching'
export const MODE_SKETCH_NO_FACE_COMMAND_SCOPE = 'mode-sketch-no-face'
export const MODE_SKETCH_SOLVE_COMMAND_SCOPE = 'mode-sketch-solve'
export const HOME_COMMAND_SCOPE = 'home'
export const COMMAND_PALETTE_OPEN_COMMAND_SCOPE = 'cmd-palette-open'
export const SETTINGS_COMMAND_SCOPE = 'settings-open'
export const PROJECT_EXPLORER_FOCUSED_COMMAND_SCOPE = 'project-explorer.focused'
export const PROJECT_EXPLORER_RENAMING_COMMAND_SCOPE =
  'project-explorer.renaming'

const COMMAND_CONTEXT_SCOPE_GROUP = 'context'
const COMMAND_PROJECT_EXPLORER_SCOPE_GROUP = 'project-explorer'

export type CommandScope = {
  id: string
  displayName: string
  priority?: number
  group?: string
  userEditable?: boolean
}

export const DEFAULT_COMMAND_SCOPES: readonly CommandScope[] = [
  {
    id: BASE_COMMAND_SCOPE,
    displayName: 'Base',
    priority: 0,
    userEditable: false,
  },
  {
    id: COMMAND_PALETTE_OPEN_COMMAND_SCOPE,
    displayName: 'Command palette open',
    priority: 2000,
    userEditable: false,
  },
  {
    id: SETTINGS_COMMAND_SCOPE,
    displayName: 'Settings open',
    priority: 1900,
    userEditable: false,
  },
  {
    id: HOME_COMMAND_SCOPE,
    displayName: 'Home',
    priority: 50,
    userEditable: false,
  },
  {
    id: CODE_EDITOR_NOT_FOCUSED_COMMAND_SCOPE,
    displayName: 'Code editor not focused',
    group: COMMAND_CONTEXT_SCOPE_GROUP,
    priority: 10,
    userEditable: false,
  },
  {
    id: MODE_MODELING_COMMAND_SCOPE,
    displayName: 'Modeling mode',
    group: COMMAND_CONTEXT_SCOPE_GROUP,
    priority: 100,
    userEditable: false,
  },
  {
    id: MODE_SKETCHING_COMMAND_SCOPE,
    displayName: 'Legacy sketch mode',
    group: COMMAND_CONTEXT_SCOPE_GROUP,
    priority: 200,
    userEditable: false,
  },
  {
    id: MODE_SKETCH_NO_FACE_COMMAND_SCOPE,
    displayName: 'Sketch no face mode',
    group: COMMAND_CONTEXT_SCOPE_GROUP,
    priority: 210,
    userEditable: false,
  },
  {
    id: MODE_SKETCH_SOLVE_COMMAND_SCOPE,
    displayName: 'Sketch mode',
    group: COMMAND_CONTEXT_SCOPE_GROUP,
    priority: 220,
    userEditable: false,
  },
  {
    id: CODE_EDITOR_FOCUSED_COMMAND_SCOPE,
    displayName: 'Code editor focused',
    group: COMMAND_CONTEXT_SCOPE_GROUP,
    priority: 1000,
    userEditable: false,
  },
  {
    id: PROJECT_EXPLORER_FOCUSED_COMMAND_SCOPE,
    displayName: 'Project explorer focused',
    group: COMMAND_PROJECT_EXPLORER_SCOPE_GROUP,
    priority: 100,
    userEditable: false,
  },
  {
    id: PROJECT_EXPLORER_RENAMING_COMMAND_SCOPE,
    displayName: 'Project explorer renaming',
    group: COMMAND_PROJECT_EXPLORER_SCOPE_GROUP,
    priority: 200,
    userEditable: false,
  },
]

export type CommandScopeService = {
  activeScopes: ReadonlySignal<readonly string[]>
  applyScope: (scopeName: string) => void
  removeScope: (scopeName: string) => void
  getCurrentScopes: () => readonly string[]
  focusScope: (scopeName: string) => {
    onFocus: () => void
    onBlur: () => void
  }
}

export type CommandSystemService = {
  actor: CommandBarActorType
  send: CommandBarActorType['send']
  useState: () => SnapshotFrom<CommandBarActorType>
}

export function normalizeCommandScopeIds(
  scopes: readonly string[] | undefined
): readonly string[] {
  const normalizedScopes = [
    ...new Set((scopes ?? []).map((scope) => scope.trim()).filter(Boolean)),
  ]
  return normalizedScopes.length > 0 ? normalizedScopes : [BASE_COMMAND_SCOPE]
}

export function getEffectiveCommandScopeSet(
  activeScopes: readonly string[],
  commandScopes: readonly CommandScope[] = []
) {
  return new Set(getEffectiveCommandScopes(activeScopes, commandScopes))
}

export function isCommandAvailable(
  command: Partial<Pick<Command, 'scopes'>>,
  effectiveScopes: ReadonlySet<string>
) {
  return normalizeCommandScopeIds(command.scopes).some((scope) =>
    effectiveScopes.has(scope)
  )
}

export function isCommandSearchable(
  command: Pick<Command, 'hideFromSearch'> & Partial<Pick<Command, 'scopes'>>,
  effectiveScopes: ReadonlySet<string>
) {
  return (
    command.hideFromSearch !== true &&
    isCommandAvailable(command, effectiveScopes)
  )
}

const DEFAULT_COMMAND_SCOPE_PRIORITY = 0

type IndexedCommandScope = {
  scope: string
  metadata: CommandScope | undefined
  index: number
}

export function getCommandScopePriority(scope: CommandScope | undefined) {
  return scope?.priority ?? DEFAULT_COMMAND_SCOPE_PRIORITY
}

export function getEffectiveCommandScopes(
  scopes: readonly string[],
  commandScopes: readonly CommandScope[] = []
) {
  const commandScopesById = new Map(
    commandScopes.map((scope) => [scope.id, scope])
  )
  const normalizedActiveScopes = new Map<string, IndexedCommandScope>()

  for (const [index, rawScope] of [BASE_COMMAND_SCOPE, ...scopes].entries()) {
    const scope = rawScope.trim()
    if (!scope) {
      continue
    }

    normalizedActiveScopes.set(scope, {
      scope,
      metadata: commandScopesById.get(scope),
      index,
    })
  }

  const ungroupedScopes: IndexedCommandScope[] = []
  const groupedScopes = new Map<string, IndexedCommandScope>()

  for (const activeScope of normalizedActiveScopes.values()) {
    const group = activeScope.metadata?.group?.trim()
    if (!group) {
      ungroupedScopes.push(activeScope)
      continue
    }

    const currentScope = groupedScopes.get(group)
    if (!currentScope || compareEffectiveScope(activeScope, currentScope) > 0) {
      groupedScopes.set(group, activeScope)
    }
  }

  return [...ungroupedScopes, ...groupedScopes.values()]
    .toSorted(compareActiveScopeOrder)
    .map((activeScope) => activeScope.scope)
}

function compareEffectiveScope(a: IndexedCommandScope, b: IndexedCommandScope) {
  const priorityDifference =
    getCommandScopePriority(a.metadata) - getCommandScopePriority(b.metadata)
  if (priorityDifference !== 0) {
    return priorityDifference
  }

  return a.index - b.index
}

function compareActiveScopeOrder(
  a: IndexedCommandScope,
  b: IndexedCommandScope
) {
  if (a.scope === BASE_COMMAND_SCOPE && b.scope !== BASE_COMMAND_SCOPE) {
    return -1
  }
  if (b.scope === BASE_COMMAND_SCOPE && a.scope !== BASE_COMMAND_SCOPE) {
    return 1
  }

  const priorityDifference =
    getCommandScopePriority(a.metadata) - getCommandScopePriority(b.metadata)
  if (priorityDifference !== 0) {
    return priorityDifference
  }

  const indexDifference = a.index - b.index
  return indexDifference !== 0
    ? indexDifference
    : a.scope.localeCompare(b.scope)
}

export const commandsContract = defineContract({
  commandScopeService: defineService<CommandScopeService>(
    'command.scope-service'
  ),
  commandScopesValueSpec: defineValueSpec<CommandScope, CommandScope[]>({
    name: 'commands.scopes',
    defaultValue: [],
    combine: combineCommandScopes,
  }),
  commandSystemService: defineService<CommandSystemService>('command-system'),
  commandsValueSpec: appendValueSpec<Command>('commands'),
})

export const {
  commandScopeService,
  commandScopesValueSpec,
  commandSystemService,
  commandsValueSpec,
} = commandsContract

export function provideCommand(command: Command) {
  return provide(commandsValueSpec, command, { key: commandKey(command) })
}

export function provideCommandScope(scope: CommandScope) {
  return provide(commandScopesValueSpec, scope, { key: scope.id })
}

function combineCommandScopes(scopes: readonly CommandScope[]) {
  return [
    ...new Map(scopes.map((scope) => [scope.id, scope])).values(),
  ].toSorted(compareCommandScopeDisplayOrder)
}

function compareCommandScopeDisplayOrder(a: CommandScope, b: CommandScope) {
  const priorityDifference =
    getCommandScopePriority(b) - getCommandScopePriority(a)
  if (priorityDifference !== 0) {
    return priorityDifference
  }

  const nameDifference = a.displayName.localeCompare(b.displayName)
  return nameDifference !== 0 ? nameDifference : a.id.localeCompare(b.id)
}
