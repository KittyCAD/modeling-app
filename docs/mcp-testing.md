# MCP Server Testing Guide

This guide explains how to test the MCP server, starting with the hello world tool.

## Prerequisites

1. Install dependencies:
   ```bash
   npm install
   ```

2. Ensure Node.js v18+ is installed (verified: v22.14.0)

## Testing the Hello World Tool

### Option 1: Test with Cursor IDE

1. Open Cursor IDE
2. Go to Settings → Features → MCP
3. Add a new MCP server with the following configuration:
   - **Type**: `stdio`
   - **Command**: `npm run mcp-server`
   - **Args**: (leave empty)
   - **Working Directory**: `/Users/kurthutten/kittycad/app-3013` (or your project path)

4. Restart Cursor or reload the MCP connection
5. In a chat, try asking: "Use the hello_world tool with name 'Test'"
6. The model should be able to call the tool and receive: "Hello, Test! The MCP server is working correctly. 🎉"

### Option 2: Test with VS Code

1. Install the MCP extension for VS Code (if available)
2. Configure the MCP server in VS Code settings
3. Similar to Cursor, the tool should be available for the AI to use

### Option 3: Manual Testing (Advanced)

You can test the server manually by:

1. Running the server:
   ```bash
   npm run mcp-server
   ```

2. The server will run on stdio and wait for JSON-RPC messages

3. Send a test message (requires understanding of MCP protocol):
   ```json
   {
     "jsonrpc": "2.0",
     "id": 1,
     "method": "tools/list",
     "params": {}
   }
   ```

## Verifying the Setup

If everything is working correctly, you should:

1. ✅ Be able to see `hello_world` in the list of available tools
2. ✅ Be able to call `hello_world` with a name parameter
3. ✅ Receive a greeting message in response

## Troubleshooting

### Server won't start
- Check that `@modelcontextprotocol/sdk` is installed: `npm list @modelcontextprotocol/sdk`
- Verify Node.js version: `node --version` (should be v18+)
- Check for TypeScript errors: `npm run build:mcp-server`

### Tool not appearing in IDE
- Verify the MCP server configuration in your IDE
- Check that the command path is correct
- Ensure the server process is running (check IDE logs)

### Tool call fails
- Check server logs (errors go to stderr)
- Verify the tool name matches exactly: `hello_world`
- Ensure the request format matches MCP spec

## Next Steps

Once the hello world tool is working:
- ✅ Phase 1 is complete
- Proceed to Phase 2: Bridge Communication
- Then Phase 4: Implement query tools (getArtifactGraph, getFeatureTree, getCurrentSelection)
