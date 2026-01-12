#!/usr/bin/env node

/**
 * MCP Server Entry Point
 *
 * This is the main entry point for the MCP server that runs as a stdio process.
 * It will be spawned by IDEs like Cursor or VS Code.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { createMcpServer } from '@src/mcp-server/server.js'

async function main() {
  const transport = new StdioServerTransport()
  const server = new Server(
    {
      name: 'zoo-design-studio-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  )

  await createMcpServer(server)

  await server.connect(transport)

  console.error('Zoo Design Studio MCP server running on stdio')
}

main().catch((error) => {
  console.error('Fatal error in MCP server:', error)
  process.exit(1)
})
