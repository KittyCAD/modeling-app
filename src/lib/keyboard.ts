import { platform } from '@src/lib/utils'

/**
 * From https://github.com/JohannesKlauss/react-hotkeys-hook/blob/main/src/parseHotkeys.ts
 * we don't want to use the whole library (as cool as it is) because it attaches
 * new listeners for each hotkey. Just the key parsing part is good for us.
 */
const reservedModifierKeywords = ['shift', 'alt', 'meta', 'mod', 'ctrl']

const mappedKeys: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  '.': 'period',
  ',': 'comma',
  '-': 'slash',
  ' ': 'space',
  '`': 'backquote',
  '#': 'backslash',
  '+': 'bracketright',
  ShiftLeft: 'shift',
  ShiftRight: 'shift',
  AltLeft: 'alt',
  AltRight: 'alt',
  MetaLeft: 'meta',
  MetaRight: 'meta',
  OSLeft: 'meta',
  OSRight: 'meta',
  ControlLeft: 'ctrl',
  ControlRight: 'ctrl',
}

export function mapKey(key: string): string {
  return (mappedKeys[key] || key)
    .trim()
    .toLowerCase()
    .replace(/key|digit|numpad|arrow/, '')
}

export function isModifierKey(key: string) {
  return reservedModifierKeywords.includes(key)
}

// Sorts keys in the order of modifier keys, then alphabetically
export function sortKeys(a: string, b: string) {
  return isModifierKey(a) ? -1 : isModifierKey(b) ? 1 : a.localeCompare(b)
}
