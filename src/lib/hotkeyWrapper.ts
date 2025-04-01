import { useEffect } from 'react'
import { Options, useHotkeys } from 'react-hotkeys-hook'

import { codeManager } from './singletons'
import { Platform } from './utils'

// Hotkey wrapper wraps hotkeys for the app (outside of the editor)
// with hotkeys inside the editor.
// This way we can have hotkeys defined in one place and not have to worry about
// conflicting hotkeys, or them only being implemented for the app but not
// inside the editor.
// TODO: would be nice if this didn't have to be a react hook. It's not needed
// for the code mirror stuff but but it is needed for the useHotkeys hook.
export default function useHotkeyWrapper(
  hotkey: string[],
  callback: () => void,
  additionalOptions?: Options
) {
  const defaultOptions = { preventDefault: true }
  const options = { ...defaultOptions, ...additionalOptions }
  useHotkeys(hotkey, callback, options)
  useEffect(() => {
    for (const key of hotkey) {
      const keybinding = mapHotkeyToCodeMirrorHotkey(key)
      codeManager.registerHotkey(keybinding, callback)
    }
  })
}

// Convert hotkey to code mirror hotkey
// See: https://codemirror.net/docs/ref/#view.KeyBinding
function mapHotkeyToCodeMirrorHotkey(hotkey: string): string {
  return hotkey
    .replaceAll('+', '-')
    .replaceAll(' ', '')
    .replaceAll('mod', 'Mod')
    .replaceAll('meta', 'Meta')
    .replaceAll('ctrl', 'Ctrl')
    .replaceAll('shift', 'Shift')
    .replaceAll('alt', 'Alt')
}

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
