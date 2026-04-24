import {
  isToolbarItemResolvedDropdown,
  type ToolbarItemResolved,
  type ToolbarItemResolvedDropdown,
} from '@src/lib/toolbar'
import { isArray } from '@src/lib/utils'

export type ResolvedToolbarEntry =
  | ToolbarItemResolved
  | ToolbarItemResolvedDropdown
  | 'break'

export type ToolbarHotkeyAction = {
  hotkey: string
  itemId: string
  onTrigger: () => void
}

const TOOLBAR_HOTKEY_MODIFIERS = new Set([
  'alt',
  'ctrl',
  'meta',
  'mod',
  'shift',
])

const TOOLBAR_HOTKEY_MODIFIER_ORDER = ['meta', 'ctrl', 'alt', 'shift']

function normalizeToolbarKey(key: string): string {
  const normalizedKey = key.trim().toLowerCase()

  if (normalizedKey === 'escape') {
    return 'esc'
  }

  return normalizedKey
}

export function normalizeToolbarHotkey(hotkey: string): string {
  const parts = hotkey
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)

  const mainKey = parts.find((part) => !TOOLBAR_HOTKEY_MODIFIERS.has(part))
  const modifiers = TOOLBAR_HOTKEY_MODIFIER_ORDER.filter((modifier) =>
    parts.includes(modifier)
  )

  return [
    ...modifiers,
    ...(mainKey ? [normalizeToolbarKey(mainKey)] : []),
  ].join('+')
}

export function getToolbarEventHotkey(
  keyboardEvent: Pick<
    KeyboardEvent,
    'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'
  >
): string | null {
  const mainKey = normalizeToolbarKey(keyboardEvent.key)

  if (!mainKey || TOOLBAR_HOTKEY_MODIFIERS.has(mainKey)) {
    return null
  }

  const modifiers = TOOLBAR_HOTKEY_MODIFIER_ORDER.filter((modifier) => {
    switch (modifier) {
      case 'meta':
        return keyboardEvent.metaKey
      case 'ctrl':
        return keyboardEvent.ctrlKey
      case 'alt':
        return keyboardEvent.altKey
      case 'shift':
        return keyboardEvent.shiftKey
      default:
        return false
    }
  })

  return [...modifiers, mainKey].join('+')
}

export function collectToolbarHotkeyActions(
  items: ResolvedToolbarEntry[]
): ToolbarHotkeyAction[] {
  const seenHotkeys = new Set<string>()
  const hotkeyActions: ToolbarHotkeyAction[] = []

  for (const item of items) {
    if (item === 'break') continue

    if (isToolbarItemResolvedDropdown(item)) {
      for (const dropdownItem of item.array) {
        registerHotkeys(dropdownItem)
      }
      continue
    }

    registerHotkeys(item)
  }

  return hotkeyActions

  function registerHotkeys(item: ToolbarItemResolved) {
    if (
      !['available', 'experimental'].includes(item.status) ||
      item.disabled ||
      item.disableHotkey ||
      !item.hotkey
    ) {
      return
    }

    for (const hotkey of isArray(item.hotkey) ? item.hotkey : [item.hotkey]) {
      // Keep the first rendered action for any conflicting hotkey.
      if (seenHotkeys.has(hotkey)) continue

      seenHotkeys.add(hotkey)
      hotkeyActions.push({
        hotkey,
        itemId: item.id,
        onTrigger: () => item.onClick(item.callbackProps),
      })
    }
  }
}
