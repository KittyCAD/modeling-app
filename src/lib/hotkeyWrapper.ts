import { useEffect } from 'react'
import type { Options } from 'react-hotkeys-hook'
import { useHotkeys } from 'react-hotkeys-hook'

import { editorManager } from '@src/lib/singletons'
import { isArray } from '@src/lib/utils'

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
      editorManager.registerHotkey(keybinding, callback)
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

/**
 * We don't want to display Esc hotkeys to avoid confusion in the Toolbar UI (eg. "EscR")
 */
export function filterEscHotkey(hotkey: string | string[]) {
  return (isArray(hotkey) ? hotkey : [hotkey]).filter((h) => h !== 'Esc')
}
