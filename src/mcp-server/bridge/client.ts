/**
 * Bridge Client
 *
 * Handles communication between MCP server and Electron app via TCP socket
 */

import { connect, type Socket } from 'net'
import type {
  BridgeMessageType,
  BridgeRequest,
  BridgeResponse,
} from '../types.js'

const DEFAULT_BRIDGE_HOST = '127.0.0.1'
const DEFAULT_BRIDGE_PORT = 9877

/**
 * MCP Bridge Client
 * Connects to Electron app's bridge server to query app state
 */
export class McpBridgeClient {
  private socket: Socket | null = null
  private host: string
  private port: number
  private connected = false
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timeout: NodeJS.Timeout
    }
  >()
  private buffer = ''

  constructor(host?: string, port?: number) {
    this.host = host || process.env.MCP_BRIDGE_HOST || DEFAULT_BRIDGE_HOST
    this.port =
      port ||
      (process.env.MCP_BRIDGE_PORT
        ? parseInt(process.env.MCP_BRIDGE_PORT, 10)
        : DEFAULT_BRIDGE_PORT)
  }

  /**
   * Connect to the Electron bridge server
   */
  async connect(): Promise<void> {
    if (this.connected && this.socket) {
      return
    }

    return new Promise((resolve, reject) => {
      const socket = connect(this.port, this.host)

      socket.on('connect', () => {
        this.socket = socket
        this.connected = true
        console.error('[MCP Bridge Client] Connected to Electron app')
        resolve()
      })

      socket.on('data', (data) => {
        this.handleData(data)
      })

      socket.on('error', (error) => {
        console.error('[MCP Bridge Client] Socket error:', error)
        if (!this.connected) {
          reject(error)
        }
        this.connected = false
      })

      socket.on('close', () => {
        console.error('[MCP Bridge Client] Connection closed')
        this.connected = false
        this.socket = null
        // Reject all pending requests
        for (const [id, { reject: rejectRequest, timeout }] of this
          .pendingRequests) {
          clearTimeout(timeout)
          rejectRequest(new Error('Bridge connection closed'))
          this.pendingRequests.delete(id)
        }
      })

      // Timeout for connection
      setTimeout(() => {
        if (!this.connected) {
          socket.destroy()
          reject(new Error('Connection timeout'))
        }
      }, 5000)
    })
  }

  /**
   * Disconnect from the bridge server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.end()
      this.socket = null
    }
    this.connected = false
    this.buffer = ''
  }

  /**
   * Send a request to the Electron app and wait for response
   */
  async request(
    type: BridgeMessageType,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.connected || !this.socket) {
      await this.connect()
    }

    const request: BridgeRequest = {
      type,
      id: `${type}-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      params,
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id)
        reject(new Error(`Request timeout for ${type}`))
      }, 10000) // 10 second timeout

      this.pendingRequests.set(request.id, {
        resolve,
        reject,
        timeout,
      })

      const message = JSON.stringify(request) + '\n'
      if (this.socket) {
        this.socket.write(message)
      } else {
        clearTimeout(timeout)
        this.pendingRequests.delete(request.id)
        reject(new Error('Not connected to bridge'))
      }
    })
  }

  /**
   * Handle incoming data from the bridge
   */
  private handleData(data: Buffer): void {
    this.buffer += data.toString()

    // Parse newline-delimited JSON messages
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || '' // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        try {
          const response = JSON.parse(line) as BridgeResponse
          this.handleResponse(response)
        } catch (error) {
          console.error('[MCP Bridge Client] Error parsing response:', error)
        }
      }
    }
  }

  /**
   * Handle a response from the bridge
   */
  private handleResponse(response: BridgeResponse): void {
    const pending = this.pendingRequests.get(response.id)
    if (pending) {
      clearTimeout(pending.timeout)
      this.pendingRequests.delete(response.id)

      if (response.success) {
        pending.resolve(response.data)
      } else {
        pending.reject(new Error(response.error || 'Unknown error'))
      }
    } else {
      console.error(
        `[MCP Bridge Client] Received response for unknown request: ${response.id}`
      )
    }
  }

  /**
   * Check if connected to the bridge
   */
  isConnected(): boolean {
    return this.connected && this.socket !== null
  }
}

// Singleton instance
let bridgeClient: McpBridgeClient | null = null

/**
 * Get or create the bridge client instance
 */
export function getBridgeClient(): McpBridgeClient {
  if (!bridgeClient) {
    bridgeClient = new McpBridgeClient()
  }
  return bridgeClient
}

/**
 * Reset the singleton (for testing)
 */
export function resetBridgeClient(): void {
  if (bridgeClient) {
    bridgeClient.disconnect()
    bridgeClient = null
  }
}
