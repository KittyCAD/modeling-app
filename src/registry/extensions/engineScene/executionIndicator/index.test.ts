import {
  Registry,
  defineRegistryItem,
  pluginsValueSpec,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { ExecutingEditorService } from '@src/registry/contracts/executingEditor'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { statusBarLocalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { describe, expect, it, vi } from 'vitest'
import executionIndicator from '.'
import { EXECUTION_INDICATOR_STATUS_BAR_ITEM_ID } from './constants'

function createExecutingEditorService(
  isExecuting = signal(false)
): ExecutingEditorService {
  return {
    code: signal(''),
    hasEditsSinceLastExecution: signal(false),
    isExecuting,
    executionElapsedMs: signal(0),
    selectionStatusLabel: signal('No selection'),
    showExperimentalFeaturesStatusBarItem: signal(true),
    getPendingCommandCount: vi.fn(() => 0),
    executeCode: vi.fn(),
    updateCode: vi.fn(),
  }
}

describe('executionIndicator plugin', () => {
  it('is disabled by default and contributes the execution status item after being enabled', () => {
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
      executionIndicator,
    ])

    const [plugin] = registry.get(pluginsValueSpec)
    expect(plugin.id).toBe('execution-indicator')
    const toggle = registry.get(plugin.service)
    expect(toggle.active.value).toBe(false)
    expect(
      registry
        .get(settingsValueSpec)
        .modeling.executionIndicator.createSetting().default
    ).toBe(false)
    expect(
      registry.get(settingsValueSpec).plugins?.['execution-indicator']
    ).toBeUndefined()
    expect(registry.get(statusBarLocalItemsValueSpec)).toEqual([])

    isExecuting.value = true

    expect(registry.get(statusBarLocalItemsValueSpec)).toEqual([])

    toggle.enable()

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual([EXECUTION_INDICATOR_STATUS_BAR_ITEM_ID])
  })

  it('removes the execution status item when the plugin is disabled again', () => {
    const isExecuting = signal(true)
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
      executionIndicator,
    ])

    const [plugin] = registry.get(pluginsValueSpec)
    const toggle = registry.get(plugin.service)
    toggle.enable()

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual([EXECUTION_INDICATOR_STATUS_BAR_ITEM_ID])

    toggle.disable()

    expect(toggle.active.value).toBe(false)
    expect(registry.get(statusBarLocalItemsValueSpec)).toEqual([])
  })
})
