import { useHotkeys } from 'react-hotkeys-hook'
import { useEffect } from 'react'
import { codeManager } from './singletons'

// Hotkey wrapper wraps hotkeys for the app (outside of the editor)
// With hotkeys inside the editor.
// This way we can have hotkeys defined in one place and not have to worry about
// conflicting hotkeys, or them only being implemented for the app but not
// inside the editor.
// TODO: would be nice if this didn't have to be a react hook. It's not needed
// for the code mirror stuff but but it is needed for the useHotkeys hook.
export default function useHotkeyWrapper(
  hotkey: string[],
  callback: () => void
) {
  useHotkeys(hotkey, callback)
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
    .replace('+', '-')
    .replace(' ', '')
    .replace('mod', 'Meta')
    .replace('ctrl', 'Ctrl')
    .replace('shift', 'Shift')
    .replace('alt', 'Alt')
}
