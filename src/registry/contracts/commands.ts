import {
  appendValueSpec,
  defineContract,
  defineService,
  provide,
} from '@kittycad/registry'
import type { Command } from '@src/lib/commandTypes'
import type { CommandBarActorType } from '@src/machines/commandBarMachine'
import type { SnapshotFrom } from 'xstate'

export type CommandSystemService = {
  actor: CommandBarActorType
  send: CommandBarActorType['send']
  useState: () => SnapshotFrom<CommandBarActorType>
}

export const commandKey = (command: Command) =>
  command.id ?? `${command.groupId}:${String(command.name)}`

export const commandsContract = defineContract({
  commandSystemService: defineService<CommandSystemService>('command-system'),
  commandsValueSpec: appendValueSpec<Command>('commands'),
})

export const { commandSystemService, commandsValueSpec } = commandsContract

export function provideCommand(command: Command) {
  return provide(commandsValueSpec, command, { key: commandKey(command) })
}
