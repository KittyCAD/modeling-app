/**
 * Fillet Edge Tool
 *
 * Tool implementation for creating fillets on selected edges.
 * This tool accepts edge selections and a radius, then modifies the AST
 * to add fillet operations.
 */

import { getBridgeClient } from '../bridge/client.js'

export const filletEdgeTool = {
  name: 'fillet_edge',
  description:
    'Create a fillet (rounded edge) on selected edges. Requires edge selections and a radius value. The edges must be from geometry in the current model.',
  inputSchema: {
    type: 'object',
    properties: {
      radius: {
        type: 'string',
        description:
          'The fillet radius as a number or KCL expression (e.g., "5", "2.5", "10mm"). Must be a positive value.',
      },
      tag: {
        type: 'string',
        description:
          'Optional tag name for the fillet operation. If provided, only one edge can be filleted at a time.',
      },
      edges: {
        type: 'array',
        description:
          'Array of edge artifact IDs to fillet. If provided, these edges will be used instead of the current selection. If not provided, the current selection will be used.',
        items: {
          type: 'string',
        },
      },
      useCurrentSelection: {
        type: 'boolean',
        description:
          'If true and edges are not provided, use the current selection from the app. Defaults to true. If edges are provided, this parameter is ignored.',
        default: true,
      },
    },
    required: ['radius'],
  },
} as const

/**
 * Handle filletEdge tool call
 */
export async function handleFilletEdgeTool(args: {
  radius: string
  tag?: string
  useCurrentSelection?: boolean
  edges?: string[]
}): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  try {
    // Validate radius
    if (!args.radius || args.radius.trim() === '') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: 'Radius is required',
                message: 'Please provide a radius value for the fillet.',
              },
              null,
              2
            ),
          },
        ],
      }
    }

    const client = getBridgeClient()

    // Determine selection source: if edges are provided, use them; otherwise use current selection
    const hasEdgeIds = args.edges && args.edges.length > 0

    if (hasEdgeIds) {
      // Use provided edge IDs (autonomous mode)
      const result = await client.request('filletEdge', {
        radius: args.radius,
        tag: args.tag,
        edges: args.edges,
        useCurrentSelection: false,
      })

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                result,
                message:
                  'Fillet operation completed. The code has been updated with the fillet call.',
              },
              null,
              2
            ),
          },
        ],
      }
    } else {
      // Use current selection from app (convenience mode)
      const useCurrentSelection = args.useCurrentSelection !== false
      const result = await client.request('filletEdge', {
        radius: args.radius,
        tag: args.tag,
        useCurrentSelection,
      })

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                result,
                message:
                  'Fillet operation completed. The code has been updated with the fillet call.',
              },
              null,
              2
            ),
          },
        ],
      }
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
                'Failed to execute fillet operation. Make sure the Electron app is running, edges are selected, and the radius is valid.',
            },
            null,
            2
          ),
        },
      ],
    }
  }
}
