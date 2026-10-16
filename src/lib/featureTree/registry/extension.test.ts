import { Registry } from '@kittycad/registry'
import {
  FEATURE_TREE_COMMANDS,
  FEATURE_TREE_FOCUSED_SCOPE,
} from '@src/lib/featureTree/registry/contract'
import {
  featureTreeExtension,
  ownsFeatureTreeKey,
} from '@src/lib/featureTree/registry/extension'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import {
  sceneBrowserSections,
  sceneBrowserService,
  sceneBrowserAppearance,
  TOGGLE_BROWSER_COMMAND,
} from '@src/lib/sceneBrowser/registry/contract'
import { sceneBrowserExtension } from '@src/lib/sceneBrowser/registry/extension'
import {
  KEYMAP_SCHEMA_VERSION,
  keymapValueSpec,
  resolveKeymapItems,
} from '@src/registry/contracts/keymap'
import { engineSceneViewExtensionsValueSpec } from '@src/registry/contracts/engineScene'
import { describe, expect, it, vi } from 'vitest'

describe('feature tree registry contribution', () => {
  it('contributes Browser sections, scoped editable bindings and semantic commands', async () => {
    const registry = new Registry()
    registry.configure([sceneBrowserExtension, featureTreeExtension])
    expect(registry.get(sceneBrowserAppearance)).toBe('hud')
    const service = registry.get(sceneBrowserService)
    expect(
      registry.get(engineSceneViewExtensionsValueSpec).map(({ id }) => id)
    ).toEqual(['browser'])
    expect(registry.get(sceneBrowserSections).map(({ id }) => id)).toEqual([
      'feature-tree',
      'bodies',
    ])
    expect(
      registry
        .get(keymapValueSpec)
        .items.find((item) => item.command === FEATURE_TREE_COMMANDS.menu)
    ).toMatchObject({
      when: [FEATURE_TREE_FOCUSED_SCOPE],
      keystrokes: ['shift+f10'],
    })
    const actions = vi.fn()
    const toggleBinding = registry
      .get(keymapValueSpec)
      .items.find((item) => item.id === TOGGLE_BROWSER_COMMAND)
    expect(toggleBinding).toMatchObject({
      title: 'Toggle scene browser',
      source: 'Scene browser',
    })
    expect(toggleBinding?.keystrokes).toEqual(['shift+t'])
    const toggle = registry
      .get(commandsValueSpec)
      .find((command) => command.id === TOGGLE_BROWSER_COMMAND)!
    await toggle.onSubmit({} as never)
    expect(service.collapsed.value).toBe(true)
    await toggle.onSubmit({} as never)
    expect(service.collapsed.value).toBe(false)
    const remapped = resolveKeymapItems(registry.get(keymapValueSpec).items, {
      version: KEYMAP_SCHEMA_VERSION,
      bindings: [{ command: TOGGLE_BROWSER_COMMAND, keystrokes: ['mod+b'] }],
    })
    expect(
      remapped.find(({ id }) => id === 'scene-browser.toggle.tree-focus')
    ).toMatchObject({
      keystrokes: ['mod+b'],
      when: [FEATURE_TREE_FOCUSED_SCOPE],
      hidden: true,
    })
    service.setTree({ focusActions: actions } as unknown as NonNullable<
      typeof service.tree.value
    >)
    const command = registry
      .get(commandsValueSpec)
      .find((command) => command.id === FEATURE_TREE_COMMANDS.actions)!
    await command.onSubmit({} as never)
    expect(actions).toHaveBeenCalledOnce()
    registry[Symbol.dispose]()
  })
  it('owns widget keys but leaves editing and modified global shortcuts alone', () => {
    const tree = document.createElement('zoo-feature-tree')
    const row = document.createElement('zoo-feature-tree-row')
    const event = new KeyboardEvent('keydown', { key: 'e' })
    vi.spyOn(event, 'composedPath').mockReturnValue([row, tree])
    expect(ownsFeatureTreeKey(event)).toBe(true)
    const input = document.createElement('input')
    vi.spyOn(event, 'composedPath').mockReturnValue([input, row, tree])
    expect(ownsFeatureTreeKey(event)).toBe(false)
    const modified = new KeyboardEvent('keydown', { key: 's', ctrlKey: true })
    vi.spyOn(modified, 'composedPath').mockReturnValue([row, tree])
    expect(ownsFeatureTreeKey(modified)).toBe(false)
  })
})
