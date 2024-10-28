import { MouseButtonName } from 'machines/interactionMapMachine'
import { INTERACTION_MAP_SEPARATOR } from './constants'

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
  if (key.includes('Button')) return key
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

export function mouseButtonToName(
  button: MouseEvent['button']
): MouseButtonName {
  switch (button) {
    case 0:
      return 'LeftButton'
    case 1:
      return 'MiddleButton'
    case 2:
      return 'RightButton'
    default:
      return 'LeftButton'
  }
}

type ResolveKeymapEvent = {
  action: string
  modifiers: string[]
  isModifier: boolean
  asString: string
}

export type InteractionEvent = MouseEvent | KeyboardEvent
export function resolveInteractionEvent(
  event: InteractionEvent
): ResolveKeymapEvent {
  // First, determine if this is a key or mouse event
  const action =
    'key' in event ? mapKey(event.code) : mouseButtonToName(event.button)

  const modifiers = [
    event.ctrlKey && 'ctrl',
    event.shiftKey && 'shift',
    event.altKey && 'alt',
    event.metaKey && 'meta',
  ].filter((item) => item !== false) as string[]
  return {
    action,
    modifiers,
    isModifier: isModifierKey(action),
    asString: [action, ...modifiers]
      .sort(sortKeys)
      .join(INTERACTION_MAP_SEPARATOR),
  }
}
