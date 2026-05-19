import type { KclManager } from '@src/lang/KclManager'
import { useEffect } from 'react'
import type { Options } from 'react-hotkeys-hook'
import { useHotkeys } from 'react-hotkeys-hook'

// Hotkey wrapper wraps hotkeys for the app (outside of the editor)
// with hotkeys inside the editor.
// This way we can have hotkeys defined in one place and not have to worry about
// conflicting hotkeys, or them only being implemented for the app but not
// inside the editor.
// TODO: would be nice if this didn't have to be a react hook. It's not needed
// for the code mirror stuff but but it is needed for the useHotkeys hook.
/**
 * @deprecated Prefer registering shortcuts through `keymapValueSpec`.
 */
export default function useHotkeyWrapper(
  hotkey: string[],
  callback: () => void,
  kclManager?: KclManager,
  additionalOptions?: Options & {
    registerToCodeMirror?: boolean
  }
) {
  const defaultOptions = { preventDefault: true }
  const options = { ...defaultOptions, ...additionalOptions }
  useHotkeys(hotkey, callback, options)
  useEffect(() => {
    if (options.registerToCodeMirror === false) {
      return
    }
    for (const key of hotkey) {
      const keybinding = mapHotkeyToCodeMirrorHotkey(key)
      kclManager?.registerHotkey(keybinding, callback)
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
