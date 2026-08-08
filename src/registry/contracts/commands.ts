import {
  appendValueSpec,
  defineContract,
  defineService,
  provide,
} from '@kittycad/registry'
import type { Command } from '@src/lib/commandTypes'
import type { CommandBarActorType } from '@src/machines/commandBarMachine'
import {
  type KeymapScope,
  getEffectiveKeymapScopes,
  getKeymapItemScopes,
} from '@src/registry/contracts/keymap'
import type { SnapshotFrom } from 'xstate'

export type CommandSystemService = {
  actor: CommandBarActorType
  send: CommandBarActorType['send']
  useState: () => SnapshotFrom<CommandBarActorType>
}

export const commandKey = (command: Command) =>
  command.id ?? `${command.groupId}:${String(command.name)}`

export function isCommandAvailable(
  command: Pick<Command, 'scopes'>,
  activeScopes: readonly string[],
  keymapScopes: readonly KeymapScope[] = []
) {
  const effectiveScopes = new Set(
    getEffectiveKeymapScopes(activeScopes, keymapScopes)
  )

  return getKeymapItemScopes(command).some((scope) =>
    effectiveScopes.has(scope)
  )
}

export function isCommandSearchable(
  command: Pick<Command, 'hideFromSearch' | 'scopes'>,
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
