/**
 * List KCL Samples Tool
 *
 * Tool implementation for listing available KCL code samples
 * Returns structured metadata about all available samples including names, descriptions, and categories
 */

import { getBridgeClient } from '../bridge/client.js'

export const listKclSamplesTool = {
  name: 'list_kcl_samples',
  description:
    'List all available KCL (KittyCAD Language) code samples. Returns an array of sample metadata including names, titles, descriptions, categories, and file information. These samples demonstrate KCL syntax, patterns, and best practices. Use get_kcl_sample to retrieve the actual code for a specific sample.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
} as const

/**
 * Handle listKclSamples tool call
 */
export async function handleListKclSamplesTool(): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  try {
    const client = getBridgeClient()
    const samplesData = await client.request('listKclSamples', {})

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              samples: samplesData,
              description:
                'Array of KCL samples with metadata. Each sample includes: name (directory name), title, description, categories (array), pathFromProjectDirectoryToFirstFile, multipleFiles (boolean), and files (array of file names). Use the name field with get_kcl_sample to retrieve the actual code.',
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
                'Failed to list KCL samples. Make sure the Electron app is running and the bridge is connected.',
            },
            null,
            2
          ),
        },
      ],
    }
  }
}
