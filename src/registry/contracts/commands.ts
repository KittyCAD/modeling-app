import {
  appendValueSpec,
  defineContract,
  defineService,
  provide,
} from '@kittycad/registry'
import type { Command } from '@src/lib/commandTypes'
import type { CommandBarActorType } from '@src/machines/commandBarMachine'
import {
  EDITABLE_FOCUSED_KEYMAP_SCOPE,
  getEffectiveKeymapScopes,
  type KeymapScope,
  normalizeKeymapScopeIds,
} from '@src/registry/contracts/keymap'
import type { SnapshotFrom } from 'xstate'

export type CommandSystemService = {
  actor: CommandBarActorType
  send: CommandBarActorType['send']
  useState: () => SnapshotFrom<CommandBarActorType>
}

export const commandKey = (command: Command) =>
  command.id ?? `${command.groupId}:${String(command.name)}`

export function getCommandPaletteScopes(activeScopes: readonly string[]) {
  return activeScopes.filter((scope) => scope !== EDITABLE_FOCUSED_KEYMAP_SCOPE)
}

export function getEffectiveCommandScopeSet(
  activeScopes: readonly string[],
  keymapScopes: readonly KeymapScope[] = []
) {
  return new Set(getEffectiveKeymapScopes(activeScopes, keymapScopes))
}

export function isCommandAvailable(
  command: Partial<Pick<Command, 'scopes'>>,
  effectiveScopes: ReadonlySet<string>
) {
  const commandScopes = normalizeKeymapScopeIds(command.scopes)
  return (
    commandScopes.length > 0 &&
    commandScopes.some((scope) => effectiveScopes.has(scope))
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

export const commandsContract = defineContract({
  commandSystemService: defineService<CommandSystemService>('command-system'),
  commandsValueSpec: appendValueSpec<Command>('commands'),
})

export const { commandSystemService, commandsValueSpec } = commandsContract

export function provideCommand(command: Command) {
  return provide(commandsValueSpec, command, { key: commandKey(command) })
}
