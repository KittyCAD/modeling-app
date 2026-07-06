import {
  Registry,
  defineRegistryItem,
  pluginsValueSpec,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import type { ExecutingEditorService } from '@src/registry/contracts/executingEditor'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import {
  MODE_MODELING_KEYMAP_SCOPE,
  keymapValueSpec,
} from '@src/registry/contracts/keymap'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { statusBarLocalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/components/ExperimentalFeaturesMenu', () => ({
  ExperimentalFeaturesMenu: () => null,
}))
vi.mock('@src/components/SelectionReferencesPopover', () => ({
  SelectionReferencesPopover: () => null,
}))
vi.mock('@src/components/SelectionStatusBarItem', () => ({
  SelectionStatusBarItem: () => null,
}))
vi.mock('@src/components/UnitsMenu', () => ({
  UnitsMenu: () => null,
}))

import engineSceneExtension, { ENGINE_SCENE_COMMAND_IDS } from '.'
import { measurementToolService } from './measurementToolService'

function createExecutingEditorService(
  isExecuting = signal(false),
  showExperimentalFeaturesStatusBarItem = signal(true)
): ExecutingEditorService {
  return {
    code: signal(''),
    hasEditsSinceLastExecution: signal(false),
    isExecuting,
    executionElapsedMs: signal(0),
    selectionStatusLabel: signal('No selection'),
    showExperimentalFeaturesStatusBarItem,
    getPendingCommandCount: vi.fn(() => 0),
    executeCode: vi.fn(),
    updateCode: vi.fn(),
  }
}

describe('engineScene extension', () => {
  it('bundles the execution indicator plugin off by default', () => {
    const registry = new Registry()
    registry.configure([engineSceneExtension])

    const executionIndicatorPlugin = registry
      .get(pluginsValueSpec)
      .find((plugin) => plugin.id === 'execution-indicator')

    expect(executionIndicatorPlugin).toBeDefined()
    if (!executionIndicatorPlugin) {
      throw new Error('Expected execution indicator plugin')
    }
    expect(
      registry
        .get(settingsValueSpec)
        .modeling.executionIndicator.createSetting().default
    ).toBe(false)
    expect(
      registry.get(settingsValueSpec).plugins?.['execution-indicator']
    ).toBeUndefined()
    expect(registry.get(executionIndicatorPlugin.service).active.value).toBe(
      false
    )
  })

  it('contributes ordered engine scene local status bar items', () => {
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-executing-editor-service',
        providesServices: [
          provideService(
            executingEditorService,
            createExecutingEditorService()
          ),
        ],
      }),
      engineSceneExtension,
    ])

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual([
      'measure',
      'selection',
      'selection-filter',
      'units',
      'experimental-features',
    ])
    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.scopes)
    ).toEqual([['file'], ['file'], ['file'], ['file'], ['file']])
  })

  it('contributes a command and modeling keybinding to open the measure tool', () => {
    measurementToolService.close()
    const registry = new Registry()
    registry.configure([engineSceneExtension])

    const command = registry
      .get(commandsValueSpec)
      .find(
        (candidate) => candidate.id === ENGINE_SCENE_COMMAND_IDS.openMeasureTool
      )
    const keymapItem = registry
      .get(keymapValueSpec)
      .items.find((item) => item.id === 'engine-scene.measure.open')

    expect(command).toMatchObject({
      displayName: 'Open measure tool',
      icon: 'ruler',
      needsReview: false,
    })
    expect(keymapItem).toMatchObject({
      title: 'Open measure tool',
      scopes: [MODE_MODELING_KEYMAP_SCOPE],
      keystrokes: ['shift+m'],
      command: ENGINE_SCENE_COMMAND_IDS.openMeasureTool,
    })

    expect(measurementToolService.isOpen.value).toBe(false)
    command?.onSubmit()
    expect(measurementToolService.isOpen.value).toBe(true)

    measurementToolService.close()
  })

  it('hides the experimental features item when file settings deny it', () => {
    const showExperimentalFeaturesStatusBarItem = signal(false)
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-executing-editor-service',
        providesServices: [
          provideService(
            executingEditorService,
            createExecutingEditorService(
              signal(false),
              showExperimentalFeaturesStatusBarItem
            )
          ),
        ],
      }),
      engineSceneExtension,
    ])

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual(['measure', 'selection', 'selection-filter', 'units'])

    showExperimentalFeaturesStatusBarItem.value = true

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual([
      'measure',
      'selection',
      'selection-filter',
      'units',
      'experimental-features',
    ])
  })
})
