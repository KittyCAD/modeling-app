/**
 * MCP Bridge for Electron Main Process
 *
 * Provides a TCP server that the MCP server can connect to
 * to query app state from the renderer process.
 */

import { createServer, type Server as NetServer } from 'net'
import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'

import type { BridgeRequest, BridgeResponse } from '@src/mcp-server/types.js'

const MCP_BRIDGE_PORT = 9877 // Default port for MCP bridge (similar to Blender's 9876)
const MCP_BRIDGE_HOST = '127.0.0.1'

let bridgeServer: NetServer | null = null
let mainWindow: BrowserWindow | null = null

/**
 * Start the MCP bridge TCP server
 */
export function startMcpBridge(window: BrowserWindow | null): void {
  if (bridgeServer) {
    console.log('[MCP Bridge] Server already running')
    return
  }

  mainWindow = window

  bridgeServer = createServer((socket) => {
    console.log('[MCP Bridge] Client connected')

    let buffer = ''

    socket.on('data', (data) => {
      buffer += data.toString()

      // Try to parse complete JSON messages (newline-delimited)
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const request = JSON.parse(line) as BridgeRequest
            void handleBridgeRequest(request, socket)
          } catch (error) {
            console.error('[MCP Bridge] Error parsing request:', error)
            sendErrorResponse(
              socket,
              'invalid-request',
              'Failed to parse request'
            )
          }
        }
      }
    })

    socket.on('error', (error) => {
      console.error('[MCP Bridge] Socket error:', error)
    })

    socket.on('close', () => {
      console.log('[MCP Bridge] Client disconnected')
    })
  })

  bridgeServer.listen(MCP_BRIDGE_PORT, MCP_BRIDGE_HOST, () => {
    console.log(
      `[MCP Bridge] Server listening on ${MCP_BRIDGE_HOST}:${MCP_BRIDGE_PORT}`
    )
  })

  bridgeServer.on('error', (error) => {
    console.error('[MCP Bridge] Server error:', error)
  })
}

/**
 * Stop the MCP bridge TCP server
 */
export function stopMcpBridge(): void {
  if (bridgeServer) {
    bridgeServer.close()
    bridgeServer = null
    console.log('[MCP Bridge] Server stopped')
  }
  mainWindow = null
}

/**
 * Handle a bridge request from the MCP server
 */
async function handleBridgeRequest(
  request: BridgeRequest,
  socket: NodeJS.ReadWriteStream
): Promise<void> {
  if (!mainWindow) {
    sendErrorResponse(socket, request.id, 'No renderer window available')
    return
  }

  try {
    let response: BridgeResponse

    switch (request.type) {
      case 'getArtifactGraph': {
        const data = await queryRenderer('mcp:getArtifactGraph', {})
        response = {
          type: request.type,
          id: request.id,
          timestamp: Date.now(),
          success: true,
          data,
        }
        break
      }

      case 'getFeatureTree': {
        const data = await queryRenderer('mcp:getFeatureTree', {})
        response = {
          type: request.type,
          id: request.id,
          timestamp: Date.now(),
          success: true,
          data,
        }
        break
      }

      case 'getCurrentSelection': {
        const data = await queryRenderer('mcp:getCurrentSelection', {})
        response = {
          type: request.type,
          id: request.id,
          timestamp: Date.now(),
          success: true,
          data,
        }
        break
      }

      default: {
        sendErrorResponse(
          socket,
          request.id,
          `Unknown request type: ${request.type}`
        )
        return
      }
    }

    sendResponse(socket, response)
  } catch (error) {
    console.error('[MCP Bridge] Error handling request:', error)
    sendErrorResponse(
      socket,
      request.id,
      error instanceof Error ? error.message : 'Unknown error'
    )
  }
}

/**
 * Query the renderer process via IPC
 * Uses a request/response pattern with unique IDs
 */
function queryRenderer(channel: string, data: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!mainWindow) {
      reject(new Error('No renderer window available'))
      return
    }

    // Check if renderer is ready
    if (mainWindow.webContents.isLoading()) {
      reject(new Error('Renderer window is still loading'))
      return
    }

    const requestId = `${channel}-${Date.now()}-${Math.random()}`
    const timeout = setTimeout(() => {
      ipcMain.removeAllListeners(`mcp:response:${requestId}`)
      reject(
        new Error('Renderer query timeout - handlers may not be initialized')
      )
    }, 10000) // 10 second timeout (increased for initial load)

    // Set up one-time listener for response
    const responseHandler = (
      _: unknown,
      response: { error?: string; data?: unknown }
    ) => {
      clearTimeout(timeout)
      ipcMain.removeListener(`mcp:response:${requestId}`, responseHandler)
      if (response.error) {
        reject(new Error(response.error))
      } else {
        resolve(response.data)
      }
    }
    ipcMain.on(`mcp:response:${requestId}`, responseHandler)

    // Send request to renderer
    try {
      mainWindow.webContents.send(channel, { requestId, ...data })
    } catch (error) {
      clearTimeout(timeout)
      ipcMain.removeListener(`mcp:response:${requestId}`, responseHandler)
      reject(error)
    }
  })
}

/**
 * Send a response to the MCP server
 */
function sendResponse(
  socket: NodeJS.ReadWriteStream,
  response: BridgeResponse
): void {
  const message = JSON.stringify(response) + '\n'
  socket.write(message)
}

/**
 * Send an error response to the MCP server
 */
function sendErrorResponse(
  socket: NodeJS.ReadWriteStream,
  requestId: string,
  error: string
): void {
  const response: BridgeResponse = {
    type: 'getArtifactGraph', // Default type, not used in error case
    id: requestId,
    timestamp: Date.now(),
    success: false,
    error,
  }
  sendResponse(socket, response)
}

/**
 * Get the bridge server port (for environment variable)
 */
export function getMcpBridgePort(): number {
  return MCP_BRIDGE_PORT
}
