import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import {
  nullableStatusBarItem,
  statusBarLocalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { createElement } from 'react'
import { EngineExecutionStatusTooltip } from './EngineExecutionStatusTooltip'
import { EXECUTION_INDICATOR_STATUS_BAR_ITEM_ID } from './constants'

const executionIndicator = defineRegistryItemFactory((ctx) => {
  const executionService = ctx.services.signal(executingEditorService)
  const statusBarItem = computed(() =>
    nullableStatusBarItem(
      (() => {
        const service = executionService.value

        return service?.isExecuting.value
          ? {
              id: EXECUTION_INDICATOR_STATUS_BAR_ITEM_ID,
              'data-testid': 'engine-executing-status',
              element: 'text' as const,
              icon: 'loading' as const,
              label: 'Engine executing',
              hideLabel: true,
              order: 0,
              scopes: ['file'],
              toolTip: {
                children: createElement(EngineExecutionStatusTooltip, {
                  executionElapsedMs: service.executionElapsedMs,
                  getPendingCommandCount: () =>
                    executionService.value?.getPendingCommandCount() ?? 0,
                }),
              },
            }
          : null
      })()
    )
  )

  return {
    item: defineRuntimeRegistryItem({
      id: 'execution-indicator.status-bar-item',
      provides: [provide(statusBarLocalItemsValueSpec, statusBarItem)],
    }),
  }
}, 'execution-indicator.status-bar-item')

export default executionIndicator
