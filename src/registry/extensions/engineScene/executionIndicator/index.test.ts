import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import type { ExecutingEditorService } from '@src/registry/contracts/executingEditor'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import { statusBarLocalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { StatusBar } from '@src/components/StatusBar/StatusBar'
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
  it('contributes a visible execution status while the engine is executing', () => {
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

    const localItems = registry.get(statusBarLocalItemsValueSpec)
    expect(localItems.map((item) => item.id)).toEqual([
      EXECUTION_INDICATOR_STATUS_BAR_ITEM_ID,
    ])

    render(
      createElement(
        MemoryRouter,
        null,
        createElement(StatusBar, { globalItems: [], localItems })
      )
    )
    expect(
      within(screen.getByTestId('engine-executing-status')).getByText(
        'Engine executing',
        { selector: 'span' }
      )
    ).toBeVisible()
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
