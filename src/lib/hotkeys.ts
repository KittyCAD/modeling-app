import { type Platform, isArray } from '@src/lib/utils'
import {
  keymapChordDisplay,
  keymapKeystrokesDisplay,
} from '@src/registry/contracts/keymap'

/**
 * @deprecated Prefer registering shortcuts through `keymapValueSpec`.
 */
export const SNAP_TO_GRID_HOTKEY = 'mod+g'

export type HotkeySequence = string | readonly string[]

/**
 * Convert hotkey or keymap sequence to display text.
 *
 * @deprecated Prefer displaying shortcuts from registry keymap metadata.
 *
 * TODO: We should handle capitalized single letter hotkeys like K as Shift+K,
 * but we don't.
 */
export function hotkeyDisplay(
  hotkey: HotkeySequence | undefined,
  platform: Platform
): string | undefined {
  if (isArray(hotkey)) {
    return keymapKeystrokesDisplay(hotkey, platform)
  }

  return keymapChordDisplay(hotkey, platform)
}
