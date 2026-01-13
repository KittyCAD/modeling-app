/**
 * Unit tests for MCP Bridge Client
 *
 * Note: These tests focus on testable logic without complex network mocking.
 * Full integration testing with actual TCP connections is done in integration tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { McpBridgeClient } from './client.js'
import type { BridgeResponse } from '../types.js'

describe('McpBridgeClient', () => {
  let client: McpBridgeClient
  const mockHost = '127.0.0.1'
  const mockPort = 9877

  beforeEach(() => {
    client = new McpBridgeClient(mockHost, mockPort)
  })

  afterEach(() => {
    client.disconnect()
  })

  describe('constructor', () => {
    it('should use default host and port when not provided', () => {
      const defaultClient = new McpBridgeClient()
      expect(defaultClient).toBeInstanceOf(McpBridgeClient)
    })

    it('should use provided host and port', () => {
      const customClient = new McpBridgeClient('localhost', 9999)
      expect(customClient).toBeInstanceOf(McpBridgeClient)
    })

    it('should use environment variables when available', () => {
      const originalEnv = process.env.MCP_BRIDGE_HOST
      const originalPort = process.env.MCP_BRIDGE_PORT
      process.env.MCP_BRIDGE_HOST = 'env-host'
      process.env.MCP_BRIDGE_PORT = '8888'

      const envClient = new McpBridgeClient()
      expect(envClient).toBeInstanceOf(McpBridgeClient)

      // Restore
      if (originalEnv) {
        process.env.MCP_BRIDGE_HOST = originalEnv
      } else {
        delete process.env.MCP_BRIDGE_HOST
      }
      if (originalPort) {
        process.env.MCP_BRIDGE_PORT = originalPort
      } else {
        delete process.env.MCP_BRIDGE_PORT
      }
    })
  })

  describe('isConnected', () => {
    it('should return false when not connected', () => {
      expect(client.isConnected()).toBe(false)
    })
  })

  describe('disconnect', () => {
    it('should handle disconnect when not connected', () => {
      expect(() => client.disconnect()).not.toThrow()
    })
  })

  describe('handleData (private method testing)', () => {
    it('should handle incomplete JSON messages in buffer', () => {
      // Access private method via type assertion for testing
      const clientAny = client as unknown as {
        handleData: (data: Buffer) => void
        buffer: string
      }

      // Send partial JSON
      clientAny.handleData(Buffer.from('{"type":"getArtifactGraph"'))
      // Verify buffer contains partial data
      expect(clientAny.buffer).toContain('getArtifactGraph')
      // Send completion
      clientAny.handleData(Buffer.from(',"id":"test-123","success":true}\n'))
      // Buffer should be cleared after complete message
      expect(clientAny.buffer).toBe('')
    })

    it('should handle multiple JSON messages in one data chunk', () => {
      const clientAny = client as unknown as {
        handleData: (data: Buffer) => void
        buffer: string
      }

      const response1: BridgeResponse = {
        type: 'getArtifactGraph',
        id: 'test-1',
        timestamp: Date.now(),
        success: true,
        data: { test: 'data1' },
      }
      const response2: BridgeResponse = {
        type: 'getFeatureTree',
        id: 'test-2',
        timestamp: Date.now(),
        success: true,
        data: { test: 'data2' },
      }

      const data =
        JSON.stringify(response1) + '\n' + JSON.stringify(response2) + '\n'
      clientAny.handleData(Buffer.from(data))
      // Buffer should be empty after processing both messages
      expect(clientAny.buffer).toBe('')
    })
  })

  describe('handleResponse (private method testing)', () => {
    it('should resolve pending request on successful response', () => {
      const clientAny = client as unknown as {
        pendingRequests: Map<
          string,
          {
            resolve: (value: unknown) => void
            reject: (error: Error) => void
            timeout: NodeJS.Timeout
          }
        >
        handleResponse: (response: BridgeResponse) => void
      }

      let resolved = false
      let resolvedValue: unknown = null

      const mockResolve = (value: unknown) => {
        resolved = true
        resolvedValue = value
      }
      const mockReject = () => {}
      const mockTimeout = setTimeout(() => {}, 1000)

      clientAny.pendingRequests.set('test-123', {
        resolve: mockResolve,
        reject: mockReject,
        timeout: mockTimeout,
      })

      const response: BridgeResponse = {
        type: 'getArtifactGraph',
        id: 'test-123',
        timestamp: Date.now(),
        success: true,
        data: { test: 'data' },
      }

      clientAny.handleResponse(response)

      expect(resolved).toBe(true)
      expect(resolvedValue).toEqual({ test: 'data' })
      expect(clientAny.pendingRequests.has('test-123')).toBe(false)
      clearTimeout(mockTimeout)
    })

    it('should reject pending request on error response', () => {
      const clientAny = client as unknown as {
        pendingRequests: Map<
          string,
          {
            resolve: (value: unknown) => void
            reject: (error: Error) => void
            timeout: NodeJS.Timeout
          }
        >
        handleResponse: (response: BridgeResponse) => void
      }

      let rejected = false
      let rejectedError: unknown = null

      const mockResolve = () => {}
      const mockReject = (error: unknown) => {
        rejected = true
        rejectedError = error
      }
      const mockTimeout = setTimeout(() => {}, 1000)

      clientAny.pendingRequests.set('test-456', {
        resolve: mockResolve,
        reject: mockReject,
        timeout: mockTimeout,
      })

      const response: BridgeResponse = {
        type: 'getArtifactGraph',
        id: 'test-456',
        timestamp: Date.now(),
        success: false,
        error: 'Test error message',
      }

      clientAny.handleResponse(response)

      expect(rejected).toBe(true)
      expect(rejectedError).not.toBeNull()
      expect(rejectedError).toBeInstanceOf(Error)
      if (rejectedError instanceof Error) {
        expect(rejectedError.message).toBe('Test error message')
      }
      expect(clientAny.pendingRequests.has('test-456')).toBe(false)
      clearTimeout(mockTimeout)
    })

    it('should handle response for unknown request ID', () => {
      const clientAny = client as unknown as {
        handleResponse: (response: BridgeResponse) => void
      }

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const response: BridgeResponse = {
        type: 'getArtifactGraph',
        id: 'unknown-123',
        timestamp: Date.now(),
        success: true,
        data: {},
      }

      clientAny.handleResponse(response)

      expect(consoleSpy).toHaveBeenCalled()
      // The error message format is: `[MCP Bridge Client] Received response for unknown request: ${response.id}`
      const callArgs = consoleSpy.mock.calls[0]
      expect(callArgs[0]).toContain('Received response for unknown request')
      expect(callArgs[0]).toContain('unknown-123')

      consoleSpy.mockRestore()
    })
  })
})
