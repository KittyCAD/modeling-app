import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { ExecutingEditorService } from '@src/registry/contracts/executingEditor'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
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

describe('executionIndicator', () => {
  it('contributes the execution status item while the engine is executing', () => {
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

    expect(registry.get(statusBarLocalItemsValueSpec)).toEqual([])

    isExecuting.value = true

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual([EXECUTION_INDICATOR_STATUS_BAR_ITEM_ID])
  })

  it('removes the execution status item when execution finishes', () => {
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

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual([EXECUTION_INDICATOR_STATUS_BAR_ITEM_ID])

    isExecuting.value = false

    expect(registry.get(statusBarLocalItemsValueSpec)).toEqual([])
  })
})
