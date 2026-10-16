import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import {
  FEATURE_TREE_COMMANDS,
  FEATURE_TREE_FOCUSED_SCOPE,
} from '@src/lib/featureTree/registry/contract'
import {
  featureTreeExtension,
  ownsFeatureTreeKey,
} from '@src/lib/featureTree/registry/extension'
import {
  commandsValueSpec,
  FILE_COMMAND_SCOPES,
  isCommandAvailable,
  isCommandSearchable,
} from '@src/registry/contracts/commands'
import {
  sceneBrowserSections,
  sceneBrowserService,
  TOGGLE_BROWSER_COMMAND,
} from '@src/lib/sceneBrowser/registry/contract'
import { sceneBrowserExtension } from '@src/lib/sceneBrowser/registry/extension'
import {
  KEYMAP_SCHEMA_VERSION,
  keymapValueSpec,
  resolveKeymapItems,
} from '@src/registry/contracts/keymap'
import { engineSceneViewExtensionsValueSpec } from '@src/registry/contracts/engineScene'
import { signal } from '@preact/signals-core'
import {
  userFeaturesService,
  type UserFeaturesRegistryService,
} from '@src/registry/contracts/userFeatures'
import { SCENE_BROWSER_FEATURE } from '@src/lib/sceneBrowser/featureFlag'
import type { UserFeaturesContext } from '@src/machines/userFeaturesMachine'
import { describe, expect, it, vi } from 'vitest'

describe('feature tree registry contribution', () => {
  it('contributes Browser sections, scoped editable bindings and semantic commands', async () => {
    const registry = new Registry()
    registry.configure([
      sceneBrowserExtension,
      featureTreeExtension,
      defineRegistryItem({
        providesServices: [
          provideService(userFeaturesService, {
            context: signal({
              featureIds: new Set([SCENE_BROWSER_FEATURE]),
            } as UserFeaturesContext),
          } as unknown as UserFeaturesRegistryService),
        ],
      }),
    ])
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
    expect(
      registry
        .get(keymapValueSpec)
        .items.filter(({ command }) => command === FEATURE_TREE_COMMANDS.edit)
    ).toMatchObject([
      { when: [FEATURE_TREE_FOCUSED_SCOPE], keystrokes: ['shift+enter'] },
      { when: [FEATURE_TREE_FOCUSED_SCOPE], keystrokes: ['shift+space'] },
    ])
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
  it('keeps disabled commands out of search and leaves the file shortcut to the legacy pane until enabled', async () => {
    const context = signal({
      featureIds: new Set<string>(),
    } as UserFeaturesContext)
    const registry = new Registry()
    registry.configure([
      sceneBrowserExtension,
      featureTreeExtension,
      defineRegistryItem({
        providesServices: [
          provideService(userFeaturesService, {
            context,
          } as unknown as UserFeaturesRegistryService),
        ],
      }),
    ])
    const browser = registry.get(sceneBrowserService)
    const actions = vi.fn()
    browser.setTree({ focusActions: actions } as unknown as NonNullable<
      typeof browser.tree.value
    >)
    const toggle = () =>
      registry
        .get(commandsValueSpec)
        .find(({ id }) => id === TOGGLE_BROWSER_COMMAND)!
    const scopes = new Set<string>(FILE_COMMAND_SCOPES)
    expect(isCommandAvailable(toggle(), scopes)).toBe(false)
    expect(isCommandSearchable(toggle(), scopes)).toBe(false)
    await toggle().onSubmit({} as never)
    expect(browser.collapsed.value).toBe(false)
    context.value = {
      ...context.value,
      featureIds: new Set([SCENE_BROWSER_FEATURE]),
    }
    expect(isCommandAvailable(toggle(), scopes)).toBe(true)
    expect(isCommandSearchable(toggle(), scopes)).toBe(true)
    await toggle().onSubmit({} as never)
    expect(browser.collapsed.value).toBe(true)
    context.value = { ...context.value, featureIds: new Set() }
    const action = registry
      .get(commandsValueSpec)
      .find(({ id }) => id === FEATURE_TREE_COMMANDS.actions)!
    await action.onSubmit({} as never)
    expect(actions).not.toHaveBeenCalled()
    expect(isCommandAvailable(toggle(), scopes)).toBe(false)
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
