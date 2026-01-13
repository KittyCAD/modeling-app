/**
 * Tool Registry
 *
 * Central registry for all MCP tools. This module:
 * - Maintains the list of available tools
 * - Registers tool listing handler (tools/list)
 * - Registers tool call handler (tools/call)
 * - Routes tool calls to appropriate handlers
 *
 * To add a new tool:
 * 1. Create tool file in `tools/` directory
 * 2. Import tool and handler here
 * 3. Add to `tools` array
 * 4. Add case to switch statement
 *
 * @see {@link ./getArtifactGraph.ts} for example tool implementation
 * @see {@link ../docs/mcp-adding-tools.md} for detailed guide
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import {
  getArtifactGraphTool,
  handleGetArtifactGraphTool,
} from './getArtifactGraph.js'
import {
  getFeatureTreeTool,
  handleGetFeatureTreeTool,
} from './getFeatureTree.js'
import {
  getCurrentSelectionTool,
  handleGetCurrentSelectionTool,
} from './getCurrentSelection.js'
import { filletEdgeTool, handleFilletEdgeTool } from './filletEdge.js'

/**
 * All available MCP tools
 *
 * Add new tools to this array to make them available to MCP clients.
 * Each tool must have:
 * - `name`: Unique tool identifier (snake_case)
 * - `description`: Human-readable description for AI assistants
 * - `inputSchema`: JSON Schema defining tool parameters
 */
const tools = [
  getArtifactGraphTool,
  getFeatureTreeTool,
  getCurrentSelectionTool,
  filletEdgeTool,
]

/**
 * Registers all tools with the MCP server
 *
 * Sets up two request handlers:
 * 1. `tools/list`: Returns list of all available tools
 * 2. `tools/call`: Routes tool calls to appropriate handlers
 *
 * @param server - The MCP server instance to register tools with
 * @returns Promise that resolves when tools are registered
 */
export async function registerTools(server: Server): Promise<void> {
  // Register handler for listing tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }
  })

  // Register handler for tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name

    switch (toolName) {
      case 'get_artifact_graph': {
        const args =
          (request.params.arguments as
            | { waitForExecution?: boolean }
            | undefined) || {}
        return handleGetArtifactGraphTool(args)
      }

      case 'get_feature_tree': {
        const args =
          (request.params.arguments as
            | { waitForExecution?: boolean }
            | undefined) || {}
        return handleGetFeatureTreeTool(args)
      }

      case 'get_current_selection': {
        const args =
          (request.params.arguments as
            | { waitForExecution?: boolean }
            | undefined) || {}
        return handleGetCurrentSelectionTool(args)
      }

      case 'fillet_edge': {
        const args = (request.params.arguments as
          | {
              radius: string
              tag?: string
              useCurrentSelection?: boolean
              edges?: string[]
            }
          | undefined) || { radius: '' }
        return handleFilletEdgeTool(args)
      }

      default: {
        // MCP protocol expects errors to be thrown for unknown tools
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw new Error(`Unknown tool: ${toolName}`)
      }
    }
  })

  // Future tools:
  // - Additional modeling operations can be added here
}
