import { type HotkeySequence, hotkeyDisplay } from '@src/lib/hotkeys'
import { type Platform, isArray } from '@src/lib/utils'

function isBareEscHotkey(chord: string) {
  return ['esc', 'escape'].includes(chord.trim().toLowerCase())
}

export function toolbarHotkeyDisplay(
  hotkey: HotkeySequence | undefined,
  platform: Platform
) {
  if (!hotkey) {
    return undefined
  }

  const hotkeySequence = isArray(hotkey) ? hotkey : [hotkey]
  if (
    hotkeySequence.length > 0 &&
    hotkeySequence.every((chord) => isBareEscHotkey(chord))
  ) {
    return undefined
  }

  return hotkeyDisplay(hotkey, platform)
}
