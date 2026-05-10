import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { ExecutingEditorService } from '@src/registry/contracts/executingEditor'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import { layoutAreaLibraryValueSpec } from '@src/registry/contracts/layout'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { statusBarLocalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { describe, expect, it, vi } from 'vitest'
import engineSceneExtension from '.'
import { ENGINE_SCENE_EXECUTION_STATUS_BAR_ITEM_ID } from './constants'

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
  it('contributes the executing spinner setting disabled by default', () => {
    const registry = new Registry()
    registry.configure([engineSceneExtension])

    const setting = registry
      .get(settingsValueSpec)
      .modeling.showExecutingSpinner.createSetting()

    expect(setting.default).toBe(false)
  })

  it('contributes the modeling layout area', () => {
    const registry = new Registry()
    registry.configure([engineSceneExtension])

    const areaLibrary = registry.get(layoutAreaLibraryValueSpec)

    expect(areaLibrary.modeling.hide()).toBe(false)
    expect(areaLibrary.modeling.Component).toBeTypeOf('function')
  })

  it('contributes ordered engine scene local status bar items', () => {
    const isExecuting = signal(false)
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-executing-editor-service',
        providesServices: [
          provideService(
            executingEditorService,
            createExecutingEditorService(isExecuting)
          ),
        ],
      }),
      engineSceneExtension,
    ])

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual(['selection', 'units', 'experimental-features'])

    isExecuting.value = true

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual([
      ENGINE_SCENE_EXECUTION_STATUS_BAR_ITEM_ID,
      'selection',
      'units',
      'experimental-features',
    ])

    isExecuting.value = false

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual(['selection', 'units', 'experimental-features'])
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
    ).toEqual(['selection', 'units'])

    showExperimentalFeaturesStatusBarItem.value = true

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual(['selection', 'units', 'experimental-features'])
  })
})
