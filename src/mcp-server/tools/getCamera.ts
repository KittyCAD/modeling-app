/**
 * Get Camera Tool
 *
 * Tool implementation for getting the current camera position and settings
 * Useful for understanding the current view and for saving camera state before changing it
 */

import { getBridgeClient } from '../bridge/client.js'
import { WAIT_FOR_EXECUTION_DESCRIPTION } from './descriptions.js'

export const getCameraTool = {
  name: 'get_camera',
  description: `Get the current camera position and settings. Useful for understanding the current view and for saving camera state before changing it. Works well with set_camera to restore views or with get_screenshot to capture the current view.`,
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
 * Handle getCamera tool call
 */
export async function handleGetCameraTool(args?: {
  waitForExecution?: boolean
}): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  try {
    const client = getBridgeClient()
    const cameraData = await client.request('getCamera', {
      waitForExecution: args?.waitForExecution ?? true,
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              camera: cameraData,
              description:
                'Current camera position and settings. Use set_camera to change the camera position, or get_screenshot to capture the current view.',
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
                'Failed to retrieve camera settings. Make sure the Electron app is running and the bridge is connected.',
            },
            null,
            2
          ),
        },
      ],
    }
  }
}
