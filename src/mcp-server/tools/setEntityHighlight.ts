/**
 * Set Entity Highlight Tool
 *
 * Tool implementation for highlighting entities in the 3D scene.
 * This tool accepts an array of entity IDs from the artifact graph and
 * highlights them in yellow in the scene. Most useful when paired with
 * the get_screenshot tool to identify where entities are located in the scene.
 *
 * Typical workflow: get_artifact_graph → set_entity_highlight → get_screenshot
 */

import { getBridgeClient } from '../bridge/client.js'
import { USE_FRESH_GRAPH_NOTICE } from './descriptions.js'

export const setEntityHighlightTool = {
  name: 'set_entity_highlight',
  description: `Highlight entities in the 3D scene by their artifact IDs. Entities will be highlighted in yellow. This is most useful when paired with the get_screenshot tool to identify where entities are located in the scene. Typical workflow: get_artifact_graph → set_entity_highlight → get_screenshot (gets IDs, highlights them, then visualizes them). ${USE_FRESH_GRAPH_NOTICE}`,
  inputSchema: {
    type: 'object',
    properties: {
      entityIds: {
        type: 'array',
        description: `Array of entity artifact IDs to highlight. These should be IDs from a recently fetched artifact graph. ${USE_FRESH_GRAPH_NOTICE}`,
        items: {
          type: 'string',
        },
      },
    },
    required: ['entityIds'],
  },
} as const

/**
 * Handle setEntityHighlight tool call
 */
export async function handleSetEntityHighlightTool(args: {
  entityIds: string[]
}): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  try {
    if (!args.entityIds || args.entityIds.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: 'Entity IDs are required',
                message: 'Please provide at least one entity ID to highlight.',
              },
              null,
              2
            ),
          },
        ],
      }
    }

    const client = getBridgeClient()
    await client.request('setEntityHighlight', {
      entityIds: args.entityIds,
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              highlightedCount: args.entityIds.length,
              entityIds: args.entityIds,
              message: `Successfully highlighted ${args.entityIds.length} entit${args.entityIds.length === 1 ? 'y' : 'ies'} in the scene.`,
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
                'Failed to highlight entities. Make sure the Electron app is running and the bridge is connected.',
            },
            null,
            2
          ),
        },
      ],
    }
  }
}
