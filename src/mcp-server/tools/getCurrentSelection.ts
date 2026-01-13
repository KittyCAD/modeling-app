/**
 * Get Current Selection Tool
 *
 * Tool implementation for querying the current user selection
 * The selection includes both graph selections (code-based) and other selections (geometry-based)
 */

import { getBridgeClient } from '../bridge/client.js'
import { WAIT_FOR_EXECUTION_DESCRIPTION } from './descriptions.js'

export const getCurrentSelectionTool = {
  name: 'get_current_selection',
  description:
    'Get the current user selection in the modeling application. This includes both code-based selections (graphSelections) and geometry-based selections (otherSelections).',
  inputSchema: {
    type: 'object',
    properties: {
      waitForExecution: {
        type: 'boolean',
        description: WAIT_FOR_EXECUTION_DESCRIPTION,
        default: true,
      },
    },
  },
} as const

/**
 * Handle getCurrentSelection tool call
 */
export async function handleGetCurrentSelectionTool(args?: {
  waitForExecution?: boolean
}): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  try {
    const client = getBridgeClient()
    const selectionData = await client.request('getCurrentSelection', {
      waitForExecution: args?.waitForExecution ?? true,
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              selection: selectionData,
              description:
                'The selection contains graphSelections (code-based selections with code references) and otherSelections (geometry-based selections like planes, axes, etc.).',
            },
            null,
            2
          ),
        },
      ],
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: error instanceof Error ? error.message : 'Unknown error',
              message:
                'Failed to retrieve current selection. Make sure the Electron app is running and the bridge is connected.',
            },
            null,
            2
          ),
        },
      ],
    }
  }
}
