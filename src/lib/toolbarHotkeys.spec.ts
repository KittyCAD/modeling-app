import { describe, expect, it, vi } from 'vitest'

import type {
  ToolbarItemCallbackProps,
  ToolbarItemResolved,
  ToolbarItemResolvedDropdown,
} from '@src/lib/toolbar'
import { collectToolbarHotkeyActions } from '@src/lib/toolbarHotkeys'

function makeResolvedItem(
  overrides: Partial<ToolbarItemResolved> = {}
): ToolbarItemResolved {
  return {
    id: overrides.id ?? 'item',
    onClick: overrides.onClick ?? vi.fn(),
    status: overrides.status ?? 'available',
    title: overrides.title ?? 'Item',
    description: overrides.description ?? 'Description',
    links: overrides.links ?? [],
    callbackProps:
      overrides.callbackProps ??
      ({
        modelingState: {} as any,
        modelingSend: vi.fn(),
        sketchPathId: false,
        editorHasFocus: false,
        isActive: false,
        keepSelection: false,
      } satisfies ToolbarItemCallbackProps),
    ...overrides,
  }
}

describe('collectToolbarHotkeyActions', () => {
  it('registers hotkeys for all dropdown items, including the first item', () => {
    const firstItemSpy = vi.fn()
    const secondItemSpy = vi.fn()
    const dropdown: ToolbarItemResolvedDropdown = {
      id: 'rectangles',
      array: [
        makeResolvedItem({
          id: 'corner-rectangle',
          title: 'Corner Rectangle',
          hotkey: 'R',
          onClick: firstItemSpy,
        }),
        makeResolvedItem({
          id: 'center-rectangle',
          title: 'Center Rectangle',
          hotkey: 'Shift+R',
          onClick: secondItemSpy,
        }),
      ],
    }

    const hotkeyActions = collectToolbarHotkeyActions([dropdown])
    const actionMap = new Map(
      hotkeyActions.map((action) => [action.hotkey, action])
    )

    expect(hotkeyActions).toHaveLength(2)

    actionMap.get('R')?.onTrigger()
    actionMap.get('Shift+R')?.onTrigger()

    expect(firstItemSpy).toHaveBeenCalledTimes(1)
    expect(secondItemSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps hotkeys for dropdown items that are not surfaced as the top-level button', () => {
    const topLevelSpy = vi.fn()
    const hiddenItemSpy = vi.fn()
    const dropdown: ToolbarItemResolvedDropdown = {
      id: 'arcs',
      array: [
        makeResolvedItem({
          id: 'center-arc',
          title: 'Center Arc',
          hotkey: 'A',
          isActive: true,
          onClick: topLevelSpy,
        }),
        makeResolvedItem({
          id: 'three-point-arc',
          title: '3-Point Arc',
          hotkey: 'Alt+A',
          onClick: hiddenItemSpy,
        }),
      ],
    }

    const hotkeyActions = collectToolbarHotkeyActions([dropdown])
    const actionMap = new Map(
      hotkeyActions.map((action) => [action.hotkey, action])
    )

    actionMap.get('Alt+A')?.onTrigger()

    expect(hiddenItemSpy).toHaveBeenCalledTimes(1)
    expect(topLevelSpy).not.toHaveBeenCalled()
  })

  it('deduplicates conflicting hotkeys in render order', () => {
    const firstSpy = vi.fn()
    const secondSpy = vi.fn()

    const hotkeyActions = collectToolbarHotkeyActions([
      makeResolvedItem({
        id: 'line',
        title: 'Line',
        hotkey: 'L',
        onClick: firstSpy,
      }),
      makeResolvedItem({
        id: 'loft',
        title: 'Loft',
        hotkey: 'L',
        onClick: secondSpy,
      }),
    ])

    expect(hotkeyActions).toHaveLength(1)

    hotkeyActions[0].onTrigger()

    expect(firstSpy).toHaveBeenCalledTimes(1)
    expect(secondSpy).not.toHaveBeenCalled()
  })

  it('skips disabled and hotkey-disabled items', () => {
    const hotkeyActions = collectToolbarHotkeyActions([
      makeResolvedItem({
        id: 'disabled-item',
        hotkey: 'D',
        disabled: true,
      }),
      makeResolvedItem({
        id: 'disable-hotkey-item',
        hotkey: 'H',
        disableHotkey: true,
      }),
      makeResolvedItem({
        id: 'enabled-item',
        hotkey: 'E',
      }),
    ])

    expect(hotkeyActions.map((action) => action.hotkey)).toEqual(['E'])
  })
})
