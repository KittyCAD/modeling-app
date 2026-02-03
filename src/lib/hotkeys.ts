import { type Platform } from '@src/lib/utils'

export const SNAP_TO_GRID_HOTKEY = 'mod+g'

const LOWER_CASE_LETTER = /[a-z]/
const WHITESPACE = /\s+/g

/**
 * Convert hotkey to display text.
 *
 * TODO: We should handle capitalized single letter hotkeys like K as Shift+K,
 * but we don't.
 */
export function hotkeyDisplay(hotkey: string, platform: Platform): string {
  const isMac = platform === 'macos'
  const isWindows = platform === 'windows'
  // Browsers call it metaKey, but that's a misnomer.
  const meta = isWindows ? 'Win' : 'Super'
  const outputSeparator = isMac ? '' : '+'
  const display = hotkey
    // Capitalize letters.  We want Ctrl+K, not Ctrl+k, since Shift should be
    // shown as a separate modifier.
    .split('+')
    .map((word) => word.trim().toLocaleLowerCase())
    .map((word) => {
      if (word.length === 1 && LOWER_CASE_LETTER.test(word)) {
        return word.toUpperCase()
      }
      return word
    })
    .join(outputSeparator)
    // Collapse multiple spaces into one.
    .replaceAll(WHITESPACE, ' ')
    .replaceAll('mod', isMac ? '⌘' : 'Ctrl')
    .replaceAll('meta', isMac ? '⌘' : meta)
    // This is technically the wrong arrow for control, but it's more visible
    // and recognizable.  May want to change this in the future.
    //
    // The correct arrow is ⌃ "UP ARROWHEAD" Unicode: U+2303
    .replaceAll('ctrl', isMac ? '^' : 'Ctrl')
    // This is technically the wrong arrow for shift, but it's more visible and
    // recognizable.  May want to change this in the future.
    //
    // The correct arrow is ⇧ "UPWARDS WHITE ARROW" Unicode: U+21E7
    .replaceAll('shift', isMac ? '⬆' : 'Shift')
    .replaceAll('alt', isMac ? '⌥' : 'Alt')

  return display
}
