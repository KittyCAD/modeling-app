/**
 * Set Camera Tool
 *
 * Tool implementation for setting the camera position and orientation
 * Particularly useful in conjunction with get_screenshot for better visibility
 */

import { getBridgeClient } from '../bridge/client.js'
import { WAIT_FOR_EXECUTION_DESCRIPTION } from './descriptions.js'

export const setCameraTool = {
  name: 'set_camera',
  description: `Set the camera position and orientation. This is particularly useful in conjunction with get_screenshot - if something is hard to see in the scene, moving the camera around can help get a better view of the geometry. You can use get_camera first to save the current view, then restore it later.`,
  inputSchema: {
    type: 'object',
    properties: {
      position: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          z: { type: 'number' },
        },
        required: ['x', 'y', 'z'],
        description: 'Camera position in 3D space (also called "vantage")',
      },
      target: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          z: { type: 'number' },
        },
        required: ['x', 'y', 'z'],
        description: 'Point the camera is looking at (also called "center")',
      },
      up: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          z: { type: 'number' },
        },
        description:
          'Up vector for the camera. Defaults to {x: 0, y: 0, z: 1} if not provided.',
        default: { x: 0, y: 0, z: 1 },
      },
      projection: {
        type: 'string',
        enum: ['perspective', 'orthographic'],
        description:
          'Camera projection type. If not provided, the current projection type is maintained.',
      },
      fov: {
        type: 'number',
        description:
          'Field of view in degrees (for perspective cameras). Defaults to 45 if not provided.',
        default: 45,
      },
      waitForExecution: {
        type: 'boolean',
        description: WAIT_FOR_EXECUTION_DESCRIPTION,
        default: true,
      },
    },
    required: ['position', 'target'],
  },
} as const

/**
 * Handle setCamera tool call
 */
export async function handleSetCameraTool(args?: {
  position?: { x: number; y: number; z: number }
  target?: { x: number; y: number; z: number }
  up?: { x: number; y: number; z: number }
  projection?: 'perspective' | 'orthographic'
  fov?: number
  waitForExecution?: boolean
}): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  try {
    if (!args?.position || !args?.target) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: 'Missing required parameters',
                message:
                  'Both position and target are required to set the camera.',
              },
              null,
              2
            ),
          },
        ],
      }
    }

    const client = getBridgeClient()
    await client.request('setCamera', {
      position: args.position,
      target: args.target,
      up: args.up ?? { x: 0, y: 0, z: 1 },
      projection: args.projection,
      fov: args.fov,
      waitForExecution: args?.waitForExecution ?? true,
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Camera position updated successfully.',
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
                'Failed to set camera position. Make sure the Electron app is running and the bridge is connected.',
            },
            null,
            2
          ),
        },
      ],
    }
  }
}
