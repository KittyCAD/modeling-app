/**
 * Get FeatureTree Tool
 *
 * Tool implementation for querying the current feature tree/operations
 * The feature tree represents the operations/features in the modeling application
 */

import { getBridgeClient } from '../bridge/client.js'
import { WAIT_FOR_EXECUTION_DESCRIPTION } from './descriptions.js'

export const getFeatureTreeTool = {
  name: 'get_feature_tree',
  description:
    'Get the current feature tree (operations list) from the modeling application. This represents all the operations/features that have been executed, such as sketches, extrusions, and other modeling operations.',
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
 * Handle getFeatureTree tool call
 */
export async function handleGetFeatureTreeTool(args?: {
  waitForExecution?: boolean
}): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  try {
    const client = getBridgeClient()
    const featureTreeData = await client.request('getFeatureTree', {
      waitForExecution: args?.waitForExecution ?? true,
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              featureTree: featureTreeData,
              description:
                'The feature tree contains an array of operations. Each operation represents a modeling command (e.g., sketch, extrude, fillet) with its parameters and source code references.',
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
                'Failed to retrieve feature tree. Make sure the Electron app is running and the bridge is connected.',
            },
            null,
            2
          ),
        },
      ],
    }
  }
}
