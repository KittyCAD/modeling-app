/**
 * Get Screenshot Tool
 *
 * Tool implementation for capturing screenshots of the 3D scene
 * Provides visual context to help LLMs understand what the model actually looks like.
 * Making multiple calls to view the part from different angles is useful for understanding the 3D geometry.
 */

import { getBridgeClient } from '../bridge/client.js'

export type ScreenshotView =
  | 'Top view'
  | 'Bottom view'
  | 'Rear view'
  | 'Front view'
  | 'Right view'
  | 'Left view'
  | 'Isometric view'
  | 'Current view'

export const getScreenshotTool = {
  name: 'get_screenshot',
  description:
    'Capture a screenshot of the 3D scene from a specified viewing angle. Making multiple calls to view the part from different angles (Top, Bottom, Front, Rear, Left, Right, Isometric) is useful for understanding the 3D geometry. The camera will be temporarily moved to the requested view, then restored to its original position.',
  inputSchema: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: [
          'Top view',
          'Bottom view',
          'Rear view',
          'Front view',
          'Right view',
          'Left view',
          'Isometric view',
          'Current view',
        ],
        description:
          'The viewing angle for the screenshot. Defaults to "Isometric view" for a standard 3D perspective. Use "Current view" to capture without changing the camera.',
        default: 'Isometric view',
      },
      waitForExecution: {
        type: 'boolean',
        description:
          'Whether to wait for any in-progress execution to complete before taking the screenshot. Defaults to true to ensure the scene is fully rendered.',
        default: true,
      },
    },
  },
} as const

/**
 * Handle getScreenshot tool call
 */
export async function handleGetScreenshotTool(args?: {
  view?: ScreenshotView
  waitForExecution?: boolean
}): Promise<{
  content: Array<
    | { type: 'image'; data: string; mimeType: string }
    | { type: 'text'; text: string }
  >
}> {
  try {
    const client = getBridgeClient()
    const screenshotDataUrl = (await client.request('getScreenshot', {
      view: args?.view ?? 'Isometric view',
      waitForExecution: args?.waitForExecution ?? true,
    })) as string

    // Extract base64 data from data URL
    // Data URL format: "data:image/png;base64,iVBORw0KGgo..."
    const dataUrlMatch = screenshotDataUrl.match(
      /^data:image\/(\w+);base64,(.+)$/
    )
    if (!dataUrlMatch) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: 'Invalid screenshot format',
                message:
                  'Expected data URL with base64 image data. Make sure the screenshot function returns a valid data URL.',
              },
              null,
              2
            ),
          },
        ],
      }
    }

    const [, imageFormat, base64Data] = dataUrlMatch
    const mimeType = `image/${imageFormat}`

    return {
      content: [
        {
          type: 'image',
          data: base64Data,
          mimeType,
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
                'Failed to capture screenshot. Make sure the Electron app is running and the bridge is connected.',
            },
            null,
            2
          ),
        },
      ],
    }
  }
}
