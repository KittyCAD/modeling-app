/**
 * Set Current KCL File Tool
 *
 * Tool implementation for changing the active/entry file
 * Useful for switching to smaller files for faster iteration
 */

import { getBridgeClient } from '../bridge/client.js'

export const setCurrentKclFileTool = {
  name: 'set_current_kcl_file',
  description:
    'Change the currently active KCL file (entry file). Accepts a file path relative to the project root. This is useful for switching to smaller files without dependencies to speed up the feedback loop. The file must exist in the current project.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description:
          'The file path relative to the project root (e.g., "main.kcl" or "components/part.kcl"). The file must exist in the current project.',
      },
    },
    required: ['filePath'],
  },
} as const

/**
 * Handle setCurrentKclFile tool call
 */
export async function handleSetCurrentKclFileTool(args?: {
  filePath?: string
}): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  try {
    if (!args?.filePath) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: 'Missing required parameter',
                message: 'filePath parameter is required',
              },
              null,
              2
            ),
          },
        ],
      }
    }

    const client = getBridgeClient()
    const result = await client.request('setCurrentKclFile', {
      filePath: args.filePath,
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: result,
              description:
                'Successfully switched to the specified file. The editor will now show this file as the active entry file.',
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
                'Failed to switch file. Make sure the file exists in the current project and the Electron app is running.',
            },
            null,
            2
          ),
        },
      ],
    }
  }
}
