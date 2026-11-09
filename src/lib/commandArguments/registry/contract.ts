import { defineService } from '@kittycad/registry'
import type { Command, CommandArgument } from '@src/lib/commandTypes'
import type { CommandKclModel } from '@src/components/CommandBar/CommandKclInput'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { EditorDialogCommit } from '@src/lib/editorDialogs/registry/contract'

export const COMMAND_ARGUMENTS_DOCUMENT = 'command.arguments'
/** Source memory and selection collection belong to the bound model, outside the serialized draft. */
export interface CommandArgumentModel extends CommandKclModel {
  artifactGraph: ArtifactGraph
  collect: (
    arg: Extract<CommandArgument<unknown>, { inputType: 'selection' }>,
    onSelect: (value: Selections, add: boolean) => void,
    onError: (message: string) => void
  ) => () => void
}
export interface CommandArgumentsBinding {
  command: Command
  context: CommandBarContext
  getModel: (
    values: Record<string, unknown>
  ) => CommandArgumentModel | undefined
  prepare: (
    values: Record<string, unknown>
  ) => Promise<EditorDialogCommit | Error>
}
export const commandArgumentsService = defineService<{
  open: (binding: CommandArgumentsBinding) => Promise<void>
}>('command-arguments')
