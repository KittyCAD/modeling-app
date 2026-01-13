/**
 * Test TCP Server for Bridge Client Tests
 *
 * This creates a real TCP server that mimics the Electron bridge server
 * for testing the bridge client without mocks.
 */

import { createServer, type Server as NetServer, type Socket } from 'net'
import type { BridgeRequest, BridgeResponse } from '../types.js'

export class TestBridgeServer {
  private server: NetServer | null = null
  private port: number
  private host: string
  private handler:
    | ((request: BridgeRequest) => Promise<BridgeResponse>)
    | null = null

  constructor(host = '127.0.0.1', port = 0) {
    this.host = host
    this.port = port
  }

  /**
   * Start the test server
   */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = createServer((socket: Socket) => {
        let buffer = ''

        socket.on('data', (data) => {
          buffer += data.toString()

          // Parse newline-delimited JSON messages
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.trim()) {
              try {
                const request = JSON.parse(line) as BridgeRequest
                void this.handleRequest(request, socket)
              } catch (error) {
                console.error('[Test Server] Error parsing request:', error)
                this.sendErrorResponse(
                  socket,
                  'invalid-request',
                  'Failed to parse request'
                )
              }
            }
          }
        })

        socket.on('error', (error) => {
          console.error('[Test Server] Socket error:', error)
        })
      })

      this.server.listen(this.port, this.host, () => {
        const address = this.server?.address()
        if (address && typeof address === 'object') {
          this.port = address.port
          resolve(address.port)
        } else {
          reject(new Error('Failed to get server port'))
        }
      })

      this.server.on('error', (error) => {
        reject(error)
      })
    })
  }

  /**
   * Set a custom request handler
   */
  setHandler(
    handler: (request: BridgeRequest) => Promise<BridgeResponse>
  ): void {
    this.handler = handler
  }

  /**
   * Handle a request
   */
  private async handleRequest(
    request: BridgeRequest,
    socket: Socket
  ): Promise<void> {
    if (this.handler) {
      try {
        const response = await this.handler(request)
        this.sendResponse(socket, response)
      } catch (error) {
        this.sendErrorResponse(
          socket,
          request.id,
          error instanceof Error ? error.message : 'Unknown error'
        )
      }
    } else {
      // Default handler - echo back success
      const response: BridgeResponse = {
        type: request.type,
        id: request.id,
        timestamp: Date.now(),
        success: true,
        data: { echo: request.params },
      }
      this.sendResponse(socket, response)
    }
  }

  /**
   * Send a response
   */
  private sendResponse(socket: Socket, response: BridgeResponse): void {
    const message = JSON.stringify(response) + '\n'
    socket.write(message)
  }

  /**
   * Send an error response
   */
  private sendErrorResponse(
    socket: Socket,
    requestId: string,
    error: string
  ): void {
    const response: BridgeResponse = {
      type: 'getArtifactGraph', // Default type
      id: requestId,
      timestamp: Date.now(),
      success: false,
      error,
    }
    this.sendResponse(socket, response)
  }

  /**
   * Stop the test server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve()
        return
      }

      this.server.close((error) => {
        if (error) {
          reject(error)
        } else {
          this.server = null
          resolve()
        }
      })
    })
  }

  /**
   * Get the server port
   */
  getPort(): number {
    return this.port
  }
}
