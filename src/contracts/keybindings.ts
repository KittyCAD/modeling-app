import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals'

/**
 * A key combination bound to a command.
 *
 * `combo` is written the way it is displayed — `Mod+K`, `Mod+Shift+P`,
 * `Escape` — with `Mod` meaning Command on macOS and Control elsewhere, so one
 * binding covers both platforms.
 */
export interface Keybinding {
  combo: string
  commandId: string
  /**
   * Bindings are ignored while focus is in a text field unless this is set.
   * Without it, every single-letter binding would fight with typing.
   */
  allowInTextInput?: boolean
}

export interface KeybindingService {
  readonly bindings: ReadonlySignal<readonly Keybinding[]>
  /** Display form for a command, for tooltips and palette rows. */
  displayFor(commandId: string): string | undefined
}

/**
 * Keybindings are a lookup from key to command id, and nothing more.
 *
 * They hold no behaviour: a binding cannot do anything a command does not
 * already do, which is what keeps the keyboard from becoming a second,
 * divergent surface for triggering work.
 */
export const keybindingsContract = defineContract({
  keybindingsValueSpec: appendValueSpec<Keybinding>('keybindings'),
  keybindingService: defineService<KeybindingService>('keybindings.service'),
})

export const { keybindingsValueSpec, keybindingService } = keybindingsContract
