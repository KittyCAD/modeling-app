# MCP Bridge Testing Guide

This guide explains how to test the MCP bridge communication between the MCP server and Electron app.

## Prerequisites

1. Electron app must be running (the bridge server starts automatically)
2. MCP server code must be built or runnable

## Testing Steps

### Step 1: Verify Bridge Server Starts

1. **Start the Electron app:**
   ```bash
   npm run tron:start
   # or for production build
   npm run tronb:vite:dev && electron-forge start
   ```

2. **Check console logs:**
   - Look for: `[MCP Bridge] Server listening on 127.0.0.1:9877`
   - This confirms the bridge server started successfully

3. **Verify port is listening:**
   ```bash
   # On macOS/Linux
   lsof -i :9877
   
   # Should show a node process listening on port 9877
   ```

### Step 2: Test Bridge Connection (Manual)

You can test the bridge connection manually using `netcat` or `telnet`:

```bash
# Connect to the bridge
nc localhost 9877
# or
telnet localhost 9877
```

Then send a test request:
```json
{"type":"getArtifactGraph","id":"test-1","timestamp":1234567890}
```

Press Enter (the bridge expects newline-delimited JSON).

You should receive a response (though it may error if renderer isn't ready).

### Step 3: Test with MCP Server Bridge Client

We can create a simple test script to verify the bridge client works.

### Step 4: Verify Renderer Handlers

1. Open Electron DevTools (if available)
2. Check that no errors appear related to MCP bridge
3. The renderer should have registered IPC handlers

## Troubleshooting

### Bridge Server Not Starting

- **Check main process logs** for errors
- **Verify** `startMcpBridge()` is called in `main.ts`
- **Check** that `mainWindow` is not null when bridge starts

### Connection Refused

- **Verify** Electron app is running
- **Check** port 9877 is not blocked by firewall
- **Verify** no other process is using port 9877

### No Response from Bridge

- **Check** renderer process is loaded (window is ready)
- **Verify** `initMcpBridgeHandlers()` was called
- **Check** renderer console for IPC errors

### Timeout Errors

- **Verify** Electron app window is fully loaded
- **Check** that kclManager is initialized
- **Increase** timeout if needed (currently 5 seconds)

## Next Steps

Once bridge is verified working:
- Proceed to Phase 4: Implement query tools
- Tools will use the bridge client to query app state
- Test tools via Cursor/VS Code MCP integration
