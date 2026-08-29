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
  /**
   * One sentence on what it does, for whoever stopped to ask.
   *
   * On the command rather than on a button, because it answers the same question
   * wherever it is asked — a toolbar tooltip, a palette row, a menu. A title says
   * which action this is; this says what it will do to your model.
   */
  description?: string
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
  /**
   * Whether this command's effect is currently in force.
   *
   * For the commands that are really toggles: a sketch tool that stays equipped
   * until you put it down, a panel that is open, a projection that is the one
   * being drawn with. Absent means the command is a one-shot action, which most
   * are.
   *
   * On the command rather than on a button for the same reason `enabled` is. A
   * toolbar, a menu row and a palette entry all want to show the same fact, and
   * a toolbar that worked it out for itself would be the only surface that knew —
   * which is what happened: the Line tool equipped correctly and no button could
   * say so.
   */
  active?: ReadonlySignal<boolean>
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
