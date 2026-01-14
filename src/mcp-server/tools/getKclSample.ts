/**
 * Get KCL Sample Tool
 *
 * Tool implementation for retrieving the KCL code for a specific sample
 * Returns the full KCL code content for the requested sample
 */

import { getBridgeClient } from '../bridge/client.js'

export const getKclSampleTool = {
  name: 'get_kcl_sample',
  description:
    'Get the KCL code for a specific sample by name. Returns the full content of a file from the requested sample. By default returns main.kcl, but you can specify any file within the sample (e.g., "car-wheel.kcl", "parameters.kcl"). Use list_kcl_samples to see all available sample names and their files. The sample name should match the directory name (e.g., "bracket", "ball-bearing", "car-wheel-assembly").',
  inputSchema: {
    type: 'object',
    properties: {
      sampleName: {
        type: 'string',
        description:
          'The name of the sample to retrieve (e.g., "bracket", "ball-bearing", "car-wheel-assembly"). Use list_kcl_samples to see all available names.',
      },
      fileName: {
        type: 'string',
        description:
          'Optional: The name of the file within the sample to retrieve (e.g., "car-wheel.kcl", "parameters.kcl"). Defaults to "main.kcl". Use list_kcl_samples to see available files for each sample.',
        default: 'main.kcl',
      },
    },
    required: ['sampleName'],
  },
} as const

/**
 * Handle getKclSample tool call
 */
export async function handleGetKclSampleTool(args?: {
  sampleName?: string
  fileName?: string
}): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  try {
    if (!args?.sampleName) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: 'sampleName parameter is required',
                message:
                  'Please provide a sampleName parameter. Use list_kcl_samples to see available samples.',
              },
              null,
              2
            ),
          },
        ],
      }
    }

    const client = getBridgeClient()
    const sampleData = await client.request('getKclSample', {
      sampleName: args.sampleName,
      fileName: args.fileName || 'main.kcl',
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              sample: sampleData,
              description:
                'Sample data including name, title, description, categories, content (the KCL code), and path. The content field contains the full KCL code that can be used as a reference or starting point.',
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
                'Failed to retrieve KCL sample. Make sure the Electron app is running, the bridge is connected, and the sample name is correct. Use list_kcl_samples to see available samples.',
            },
            null,
            2
          ),
        },
      ],
    }
  }
}
