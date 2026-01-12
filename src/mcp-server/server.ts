/**
 * MCP Server Implementation
 *
 * Sets up the MCP server with tools and handlers
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'

import { registerTools } from '@src/mcp-server/tools/registry.js'

/**
 * Creates and configures the MCP server
 */
export async function createMcpServer(server: Server): Promise<void> {
  // Register all tools
  await registerTools(server)

  // Set up error handling
  server.onerror = (error) => {
    console.error('[MCP Server Error]', error)
  }

  // Handle shutdown
  process.on('SIGINT', () => {
    void server.close().then(() => {
      process.exit(0)
    })
  })

  process.on('SIGTERM', () => {
    void server.close().then(() => {
      process.exit(0)
    })
  })
}
