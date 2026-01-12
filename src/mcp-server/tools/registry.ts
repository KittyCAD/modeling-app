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

import {
  handleHelloWorldTool,
  helloWorldTool,
} from '@src/mcp-server/tools/helloWorld.js'

/**
 * All available tools
 */
const tools = [helloWorldTool]

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

      default: {
        // MCP protocol expects errors to be thrown for unknown tools
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw new Error(`Unknown tool: ${toolName}`)
      }
    }
  })

  // Future tools will be added to the tools array and handled in the switch statement:
  // - getArtifactGraph
  // - getFeatureTree
  // - getCurrentSelection
  // - filletEdge (Phase 7)
}
