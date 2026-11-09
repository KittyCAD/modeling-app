import { computed } from '@preact/signals-core'
import { projectSession } from '@src/registry/contracts/projectSession'
import {
  nullableStatusBarItem,
  statusBarLocalItemsFacet,
} from '@src/registry/contracts/statusBar'
import { contribute, type Subtree } from 'plankton'
import { createElement } from 'react'
import { EXECUTION_INDICATOR_STATUS_BAR_ITEM_ID } from './constants'
import { EngineExecutionStatusTooltip } from './EngineExecutionStatusTooltip'

const executionIndicator = {
  key: 'execution-indicator.status-bar-item',
  create: (ctx) => {
    const session = computed(() => ctx.optional(projectSession))
    const executionService = computed(
      () => session.value?.executingEditor.value
    )
    const statusBarItem = computed(() =>
      nullableStatusBarItem(
        (() => {
          const service = executionService.value
          if (!service) return null

          const isExecuting = service.isExecuting.value
          return isExecuting || service.executionElapsedMs.value !== null
            ? {
                id: EXECUTION_INDICATOR_STATUS_BAR_ITEM_ID,
                'data-testid': 'engine-executing-status',
                element: 'text' as const,
                icon: isExecuting
                  ? ('loading' as const)
                  : ('checkmark' as const),
                label: isExecuting
                  ? 'Engine executing'
                  : 'Engine execution finished',
                hideLabel: true,
                order: 0,
                scopes: ['file'],
                toolTip: {
                  children: createElement(EngineExecutionStatusTooltip, {
                    isExecuting,
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
      items: [contribute(statusBarLocalItemsFacet, () => statusBarItem.value)],
    }
  },
} satisfies Subtree
export default executionIndicator
