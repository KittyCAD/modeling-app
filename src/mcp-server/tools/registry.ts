/**
 * Tool Registry
 *
 * Registers all MCP tools with the server
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { handleHelloWorldTool, helloWorldTool } from './helloWorld.js'
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

/**
 * All available tools
 */
const tools = [
  helloWorldTool,
  getArtifactGraphTool,
  getFeatureTreeTool,
  getCurrentSelectionTool,
]

/**
 * Registers all tools with the MCP server
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
      case 'hello_world': {
        const args = request.params.arguments as { name?: string } | undefined
        return handleHelloWorldTool(args)
      }

      case 'get_artifact_graph': {
        return handleGetArtifactGraphTool()
      }

      case 'get_feature_tree': {
        return handleGetFeatureTreeTool()
      }

      case 'get_current_selection': {
        return handleGetCurrentSelectionTool()
      }

      default: {
        // MCP protocol expects errors to be thrown for unknown tools
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw new Error(`Unknown tool: ${toolName}`)
      }
    }
  })

  // Future tools:
  // - filletEdge (Phase 7)
}
