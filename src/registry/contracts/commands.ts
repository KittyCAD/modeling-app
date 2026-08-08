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

export function getCommandScopes(
  command: Partial<Pick<Command, 'scopes'>>
): readonly string[] {
  return [
    ...new Set(command.scopes?.map((scope) => scope.trim()).filter(Boolean)),
  ]
}

export function isCommandAvailable(
  command: Partial<Pick<Command, 'scopes'>>,
  activeScopes: readonly string[],
  keymapScopes: readonly KeymapScope[] = []
) {
  const commandScopes = getCommandScopes(command)
  if (commandScopes.length === 0) {
    return false
  }

  const effectiveScopes = new Set(
    getEffectiveKeymapScopes(activeScopes, keymapScopes)
  )

  return commandScopes.some((scope) => effectiveScopes.has(scope))
}

export function isCommandSearchable(
  command: Pick<Command, 'hideFromSearch'> & Partial<Pick<Command, 'scopes'>>,
  activeScopes: readonly string[],
  keymapScopes: readonly KeymapScope[] = []
) {
  return (
    command.hideFromSearch !== true &&
    isCommandAvailable(command, activeScopes, keymapScopes)
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
