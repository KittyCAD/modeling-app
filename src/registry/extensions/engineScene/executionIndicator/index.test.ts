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
  isExecuting = signal(false),
  executionElapsedMs = signal<number | null>(null)
): ExecutingEditorService {
  return {
    code: signal(''),
    hasEditsSinceLastExecution: signal(false),
    isExecuting,
    executionElapsedMs,
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

  it('keeps a checkmark after execution finishes and restores the spinner on the next run', () => {
    const isExecuting = signal(true)
    const executionElapsedMs = signal<number | null>(0)
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-executing-editor-service',
        providesServices: [
          provideService(
            executingEditorService,
            createExecutingEditorService(isExecuting, executionElapsedMs)
          ),
        ],
      }),
      executionIndicator,
    ])

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual([EXECUTION_INDICATOR_STATUS_BAR_ITEM_ID])

    executionElapsedMs.value = 1234
    isExecuting.value = false

    expect(registry.get(statusBarLocalItemsValueSpec)).toMatchObject([
      {
        id: EXECUTION_INDICATOR_STATUS_BAR_ITEM_ID,
        icon: 'checkmark',
        label: 'Engine execution finished',
      },
    ])

    isExecuting.value = true
    executionElapsedMs.value = 0

    expect(registry.get(statusBarLocalItemsValueSpec)).toMatchObject([
      { icon: 'loading', label: 'Engine executing' },
    ])
  })

  it('shows a completed execution even when it took zero milliseconds', () => {
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-executing-editor-service',
        providesServices: [
          provideService(
            executingEditorService,
            createExecutingEditorService(signal(false), signal(0))
          ),
        ],
      }),
      executionIndicator,
    ])

    expect(registry.get(statusBarLocalItemsValueSpec)).toMatchObject([
      { icon: 'checkmark' },
    ])
  })
})
