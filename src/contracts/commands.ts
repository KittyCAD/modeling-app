import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'
import type { IconName } from '@kittycad/ui-kit'

export interface Command {
  id: string
  /** Imperative and specific: "Open project", not "Project opening". */
  title: string
  /** Groups the command in the palette. */
  category?: string
  icon?: IconName
  /** Display form, e.g. `⌘K`. Binding itself lives with the keymap. */
  shortcut?: string
  /**
   * Whether the command can run now.
   *
   * Unavailable commands are shown disabled rather than hidden: a command that
   * vanishes teaches nobody why it is unavailable.
   */
  enabled?: ReadonlySignal<boolean>
  run: () => void | Promise<void>
}

export interface CommandService {
  readonly all: ReadonlySignal<readonly Command[]>
  get(id: string): Command | undefined
  /** No-ops with a warning if the command is missing or disabled. */
  run(id: string): void
}

/**
 * Every user-triggerable action in the app.
 *
 * One list, contributed to by any feature. The command is the unit of
 * behaviour; the top bar, the palette, a keybinding, and a menu are all just
 * different ways to reach the same entry, so none of them holds logic of its
 * own.
 */
export const commandsContract = defineContract({
  commandsValueSpec: appendValueSpec<Command>('commands'),
  commandService: defineService<CommandService>('commands.service'),
})

export const { commandsValueSpec, commandService } = commandsContract
