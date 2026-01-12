/**
 * Get Current Selection Tool
 *
 * Tool implementation for querying the current user selection
 * The selection includes both graph selections (code-based) and other selections (geometry-based)
 */

import { getBridgeClient } from '../bridge/client.js'

export const getCurrentSelectionTool = {
  name: 'get_current_selection',
  description:
    'Get the current user selection in the modeling application. This includes both code-based selections (graphSelections) and geometry-based selections (otherSelections).',
  inputSchema: {
    type: 'object',
    properties: {},
  },
} as const

/**
 * Handle getCurrentSelection tool call
 */
export async function handleGetCurrentSelectionTool(): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  try {
    const client = getBridgeClient()
    const selectionData = await client.request('getCurrentSelection')

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
