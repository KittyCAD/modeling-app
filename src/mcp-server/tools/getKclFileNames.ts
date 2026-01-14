/**
 * Get KCL File Names Tool
 *
 * Tool implementation for listing all KCL files in the current project
 * Helps LLMs understand project structure and file organization
 */

import { getBridgeClient } from '../bridge/client.js'

export const getKclFileNamesTool = {
  name: 'get_kcl_file_names',
  description:
    'List all KCL files in the current project. Returns an array of file paths (relative to project root) with metadata. The current entry file is marked with `isEntryFile: true`. This helps understand the project structure and identify which files are available for editing.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
} as const

/**
 * Handle getKclFileNames tool call
 */
export async function handleGetKclFileNamesTool(): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  try {
    const client = getBridgeClient()
    const fileListData = await client.request('getKclFileNames', {})

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              files: fileListData,
              description:
                'Array of KCL files in the project. Each file has: `path` (relative to project root), `name` (filename with extension), `isEntryFile` (true if this is the currently active file), and optionally `size` (file size in bytes) and `modified` (last modified timestamp).',
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
                'Failed to retrieve KCL file list. Make sure a project is loaded and the Electron app is running.',
            },
            null,
            2
          ),
        },
      ],
    }
  }
}
