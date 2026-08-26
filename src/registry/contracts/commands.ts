import {
  appendValueSpec,
  defineContract,
  defineService,
  provide,
} from '@kittycad/registry'
import type { Command } from '@src/lib/commandTypes'
import { commandKey } from '@src/lib/commandUtils'
import type { CommandBarActorType } from '@src/machines/commandBarMachine'
import type { SnapshotFrom } from 'xstate'

export { commandKey } from '@src/lib/commandUtils'

export type CommandSystemService = {
  actor: CommandBarActorType
  send: CommandBarActorType['send']
  useState: () => SnapshotFrom<CommandBarActorType>
}

export const commandsContract = defineContract({
  commandSystemService: defineService<CommandSystemService>('command-system'),
  commandsValueSpec: appendValueSpec<Command>('commands'),
})

export const { commandSystemService, commandsValueSpec } = commandsContract

export function provideCommand(command: Command) {
  return provide(commandsValueSpec, command, { key: commandKey(command) })
}
