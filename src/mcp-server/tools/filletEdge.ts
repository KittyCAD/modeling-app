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
      useCurrentSelection: {
        type: 'boolean',
        description:
          'If true, use the current selection from the app. If false, edges must be provided in the edges parameter. Defaults to true.',
        default: true,
      },
      edges: {
        type: 'array',
        description:
          'Array of edge artifact IDs to fillet. Only used if useCurrentSelection is false.',
        items: {
          type: 'string',
        },
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

    // Determine selection source
    const useCurrentSelection = args.useCurrentSelection !== false

    if (useCurrentSelection) {
      // Use current selection from app
      const result = await client.request('filletEdge', {
        radius: args.radius,
        tag: args.tag,
        useCurrentSelection: true,
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
      // Use provided edge IDs
      if (!args.edges || args.edges.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: 'No edges provided',
                  message:
                    'When useCurrentSelection is false, you must provide edge IDs in the edges parameter.',
                },
                null,
                2
              ),
            },
          ],
        }
      }

      const result = await client.request('filletEdge', {
        radius: args.radius,
        tag: args.tag,
        useCurrentSelection: false,
        edges: args.edges,
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
