/**
 * MCP Server Implementation
 *
 * Sets up the MCP server with tools and handlers.
 * This is the main server configuration that registers all tools
 * and sets up lifecycle management (error handling, shutdown).
 *
 * @see {@link ./tools/registry.ts} for tool registration
 * @see {@link ./index.ts} for server entry point
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'

import { registerTools } from './tools/registry.js'

/**
 * Creates and configures the MCP server
 *
 * This function:
 * 1. Registers all available tools with the server
 * 2. Sets up error handling
 * 3. Configures graceful shutdown on SIGINT/SIGTERM
 *
 * @param server - The MCP server instance from @modelcontextprotocol/sdk
 * @returns Promise that resolves when server is configured
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
