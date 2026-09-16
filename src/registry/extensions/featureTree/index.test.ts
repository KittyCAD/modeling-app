import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  createRowUserBinding,
  getKeybindingRows,
} from '@src/components/Settings/keybindingRows'
import {
  DefaultLayoutPaneID,
  defaultLayoutConfig,
} from '@src/lib/layout/configs/default'
import { playwrightLayoutConfig } from '@src/lib/layout/configs/playwright'
import { layoutService } from '@src/lib/layout/registry/contract'
import type { Layout } from '@src/lib/layout/types'
import { getOpenPanes } from '@src/lib/layout/utils'
import {
  DEFAULT_COMMAND_SCOPES,
  FILE_COMMAND_SCOPES,
  commandKey,
  commandsValueSpec,
  getEffectiveCommandScopeSet,
  isCommandAvailable,
} from '@src/registry/contracts/commands'
import {
  CODE_EDITOR_FOCUSED_KEYMAP_SCOPE,
  EDITABLE_FOCUSED_KEYMAP_SCOPE,
  HOME_KEYMAP_SCOPE,
  MODE_MODELING_KEYMAP_SCOPE,
  SETTINGS_KEYMAP_SCOPE,
  createEmptyPersistedKeymap,
  createKeymapTree,
  createUnbindBinding,
  keymapValueSpec,
  matchKeymapKeystrokes,
  resolveKeymapItems,
} from '@src/registry/contracts/keymap'
import featureTreeExtension from '@src/registry/extensions/featureTree'
import { describe, expect, it, vi } from 'vitest'

function setup(initialLayout = defaultLayoutConfig) {
  const currentLayout = signal(structuredClone(initialLayout))
  const setLayout = vi.fn((layout: Layout) => {
    currentLayout.value = layout
  })
  const registry = new Registry()
  registry.configure([
    defineRegistryItem({
      providesServices: [
        provideService(layoutService, {
          signal: currentLayout,
          get: () => currentLayout.value,
          set: setLayout,
          reset: () => {
            currentLayout.value = structuredClone(initialLayout)
          },
          applyContributions: () => [],
        }),
      ],
    }),
    featureTreeExtension,
  ])
  const persistedKeymap = createEmptyPersistedKeymap()
  const contributedItems = registry.get(keymapValueSpec).items

  const runShortcut = (
    chord: string,
    scopes: readonly string[] = [MODE_MODELING_KEYMAP_SCOPE]
  ) => {
    const commands = registry.get(commandsValueSpec)
    const effectiveScopes = getEffectiveCommandScopeSet(
      scopes,
      DEFAULT_COMMAND_SCOPES
    )
    const match = matchKeymapKeystrokes(
      createKeymapTree(resolveKeymapItems(contributedItems, persistedKeymap)),
      scopes,
      [chord],
      DEFAULT_COMMAND_SCOPES,
      (item) =>
        commands.some(
          (command) =>
            commandKey(command) === item.command &&
            isCommandAvailable(command, effectiveScopes)
        )
    )
    if (match.type !== 'full') return false
    const command = commands.find(
      (command) => commandKey(command) === match.item.command
    )
    if (!command) return false
    command.onSubmit()
    return true
  }

  return { registry, currentLayout, setLayout, persistedKeymap, runShortcut }
}

describe('Feature Tree keybinding', () => {
  it.each([
    ['default', defaultLayoutConfig],
    ['Playwright', playwrightLayoutConfig],
  ])(
    'toggles the whole pane in the %s layout without changing siblings',
    (_, layout) => {
      const { registry, currentLayout, runShortcut } = setup(layout)
      using _registry = registry
      const originalLayout = currentLayout.value
      const originalOpenPanes = getOpenPanes({ rootLayout: originalLayout })
      const wasOpen = originalOpenPanes.includes(
        DefaultLayoutPaneID.FeatureTree
      )

      expect(runShortcut('shift+t')).toBe(true)
      const openPanes = getOpenPanes({ rootLayout: currentLayout.value })
      expect(openPanes.includes(DefaultLayoutPaneID.FeatureTree)).toBe(!wasOpen)
      expect(
        openPanes.filter((id) => id !== DefaultLayoutPaneID.FeatureTree)
      ).toEqual(
        originalOpenPanes.filter((id) => id !== DefaultLayoutPaneID.FeatureTree)
      )
      expect(getOpenPanes({ rootLayout: originalLayout })).toEqual(
        originalOpenPanes
      )

      expect(runShortcut('shift+t')).toBe(true)
      expect(getOpenPanes({ rootLayout: currentLayout.value })).toEqual(
        originalOpenPanes
      )
    }
  )

  it.each(FILE_COMMAND_SCOPES)('is available in %s', (scope) => {
    const { registry, runShortcut, setLayout } = setup()
    using _registry = registry

    expect(runShortcut('shift+t', [scope])).toBe(true)
    expect(setLayout).toHaveBeenCalledOnce()
  })

  it.each([
    CODE_EDITOR_FOCUSED_KEYMAP_SCOPE,
    EDITABLE_FOCUSED_KEYMAP_SCOPE,
    SETTINGS_KEYMAP_SCOPE,
  ])(
    'does not toggle in %s even with a modeling scope still applied',
    (scope) => {
      const { registry, runShortcut, setLayout } = setup()
      using _registry = registry

      expect(runShortcut('shift+t', [MODE_MODELING_KEYMAP_SCOPE, scope])).toBe(
        false
      )
      expect(setLayout).not.toHaveBeenCalled()
    }
  )

  it('does not toggle on the home page', () => {
    const { registry, runShortcut, setLayout } = setup()
    using _registry = registry

    expect(runShortcut('shift+t', [HOME_KEYMAP_SCOPE])).toBe(false)
    expect(setLayout).not.toHaveBeenCalled()
  })

  it('can be rebound and unbound through its Keybindings settings row', () => {
    const { registry, runShortcut, persistedKeymap, currentLayout } = setup()
    using _registry = registry
    const row = getKeybindingRows(registry.get(keymapValueSpec).items, []).find(
      (row) => row.title === 'Toggle Feature Tree'
    )
    expect(row).toBeDefined()
    if (!row?.appItem)
      throw new Error('Missing editable Feature Tree keybinding')

    persistedKeymap.bindings = [
      createRowUserBinding(row, ['mod+shift+y'], row.when),
    ]
    expect(runShortcut('shift+t')).toBe(false)
    expect(runShortcut('mod+shift+y')).toBe(true)
    expect(getOpenPanes({ rootLayout: currentLayout.value })).not.toContain(
      DefaultLayoutPaneID.FeatureTree
    )

    persistedKeymap.bindings = [createUnbindBinding(row.appItem)]
    expect(runShortcut('shift+t')).toBe(false)
    expect(runShortcut('mod+shift+y')).toBe(false)
  })
})
