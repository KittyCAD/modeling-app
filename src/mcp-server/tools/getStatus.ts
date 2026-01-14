/**
 * Get Status Tool
 *
 * Tool implementation for querying the current application status
 * Reports execution state and CodeMirror diagnostics (parse and execution errors)
 */

import { getBridgeClient } from '../bridge/client.js'

const WAIT_FOR_EXECUTION_DESCRIPTION_STATUS =
  'Whether to wait for any in-progress execution to complete before returning status. Defaults to false for quick status checks, but set to true if you want to see errors and diagnostics after execution completes.'

export const getStatusTool = {
  name: 'get_status',
  description:
    'Get the current application status, including whether execution is in progress and any diagnostics (parse errors, execution errors) from the CodeMirror gutter.',
  inputSchema: {
    type: 'object',
    properties: {
      waitForExecution: {
        type: 'boolean',
        description: WAIT_FOR_EXECUTION_DESCRIPTION_STATUS,
        default: false,
      },
    },
  },
} as const

/**
 * Handle getStatus tool call
 */
export async function handleGetStatusTool(args?: {
  waitForExecution?: boolean
}): Promise<{
  content: Array<{ type: 'text'; text: string }>
}> {
  try {
    const client = getBridgeClient()
    const statusData = await client.request('getStatus', {
      waitForExecution: args?.waitForExecution ?? false,
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: statusData,
              description:
                'Status includes isExecuting (whether code execution is in progress), diagnostics (array of parse/execution errors from CodeMirror gutter, each with from/to positions, message, and severity), projectName (name of the current project folder, or null if not in a project), and isOnHomeScreen (optional field, present only when true, indicating the user is on the home screen). Note: The MCP tools are most useful when a project is loaded. If isOnHomeScreen is present or projectName is null, the user should open a project to use the MCP effectively.',
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
                'Failed to retrieve status. Make sure the Electron app is running and the bridge is connected.',
            },
            null,
            2
          ),
        },
      ],
    }
  }
}
