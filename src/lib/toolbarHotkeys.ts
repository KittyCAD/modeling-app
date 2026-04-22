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
