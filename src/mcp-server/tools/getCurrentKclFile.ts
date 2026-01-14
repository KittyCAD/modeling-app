/**
 * Get Current KCL File Tool
 *
 * Tool implementation for getting the currently active/entry file path
 * Helps LLMs understand which file they are currently editing
 */

import { getBridgeClient } from '../bridge/client.js'

export const getCurrentKclFileTool = {
  name: 'get_current_kcl_file',
  description:
    'Get the currently active KCL file path (the entry file). Returns the file path relative to the project root. This helps understand which file is currently being edited.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
} as const

/**
 * Handle getCurrentKclFile tool call
 */
export async function handleGetCurrentKclFileTool(): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  try {
    const client = getBridgeClient()
    const currentFileData = await client.request('getCurrentKclFile', {})

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              currentFile: currentFileData,
              description:
                'The currently active KCL file path, relative to the project root. Returns null if no file is currently open.',
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
                'Failed to retrieve current file. Make sure a project is loaded and the Electron app is running.',
            },
            null,
            2
          ),
        },
      ],
    }
  }
}
