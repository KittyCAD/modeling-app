/**
 * Integration tests for tool registry
 *
 * These tests verify that the tool registry correctly registers handlers
 * and that the handlers work with a real bridge client connection.
 * Uses a test TCP server instead of mocks to catch real integration issues.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { registerTools } from './registry.js'
import { TestBridgeServer } from '../bridge/test-server.js'
import type { BridgeRequest, BridgeResponse } from '../types.js'
import { isArray } from '@src/lib/utils'

// Use real bridge client - no mocks!
// We'll use a test TCP server instead

describe('Tool Registry Integration', () => {
  let server: Server
  let testServer: TestBridgeServer
  let testPort: number

  beforeEach(async () => {
    // Create a real test TCP server
    testServer = new TestBridgeServer('127.0.0.1', 0) // Port 0 = random available port
    testPort = await testServer.start()

    // Set environment variable so bridge client uses test server
    process.env.MCP_BRIDGE_PORT = testPort.toString()

    server = new Server(
      {
        name: 'test-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    )
  })

  afterEach(async () => {
    await testServer.stop()
    delete process.env.MCP_BRIDGE_PORT
    // Reset singleton to avoid test pollution
    const { resetBridgeClient } = await import('../bridge/client.js')
    resetBridgeClient()
  })

  it('should register all tools and list them correctly', async () => {
    await registerTools(server)

    // Access the registered handler directly
    const handler = server['_requestHandlers'].get('tools/list')
    expect(handler).toBeDefined()

    if (handler) {
      const response = await handler({
        method: 'tools/list',
        params: {},
      } as Parameters<typeof handler>[0])

      expect(response.tools).toHaveLength(11)
      expect(response.tools.map((t: { name: string }) => t.name)).toEqual([
        'get_artifact_graph',
        'get_feature_tree',
        'get_current_selection',
        'fillet_edge',
        'get_status',
        'get_screenshot',
        'list_kcl_samples',
        'get_kcl_sample',
        'get_kcl_file_names',
        'get_current_kcl_file',
        'set_current_kcl_file',
        'set_current_kcl_file',
      ])
    }
  })

  it('should return tool metadata for each tool', async () => {
    await registerTools(server)

    const handler = server['_requestHandlers'].get('tools/list')
    expect(handler).toBeDefined()

    if (handler) {
      const response = await handler({
        method: 'tools/list',
        params: {},
      } as Parameters<typeof handler>[0])

      for (const tool of response.tools) {
        expect(tool).toHaveProperty('name')
        expect(tool).toHaveProperty('description')
        expect(tool).toHaveProperty('inputSchema')
        expect(typeof tool.name).toBe('string')
        expect(typeof tool.description).toBe('string')
        expect(tool.inputSchema).toHaveProperty('type')
      }
    }
  })

  it('should handle tool call requests with real bridge connection', async () => {
    // Set up test server to return mock data
    testServer.setHandler(
      async (request: BridgeRequest): Promise<BridgeResponse> => {
        if (request.type === 'getArtifactGraph') {
          return {
            type: request.type,
            id: request.id,
            timestamp: Date.now(),
            success: true,
            data: [
              ['artifact-1', { type: 'path', codeRef: { range: [0, 10] } }],
            ],
          }
        }
        return {
          type: request.type,
          id: request.id,
          timestamp: Date.now(),
          success: false,
          error: 'Unknown request type',
        }
      }
    )

    await registerTools(server)

    const handler = server['_requestHandlers'].get('tools/call')
    expect(handler).toBeDefined()

    if (handler) {
      const response = await handler({
        method: 'tools/call',
        params: {
          name: 'get_artifact_graph',
          arguments: {},
        },
      } as Parameters<typeof handler>[0])

      expect(response).toHaveProperty('content')
      expect(isArray(response.content)).toBe(true)
      expect(response.content[0]).toHaveProperty('type')
      expect(response.content[0]).toHaveProperty('text')

      // Verify the response contains the actual data from the bridge
      const parsed = JSON.parse(response.content[0].text)
      expect(parsed.artifactGraph).toBeDefined()
    }
  })

  it('should handle waitForExecution parameter for get_artifact_graph', async () => {
    testServer.setHandler(
      async (request: BridgeRequest): Promise<BridgeResponse> => {
        if (request.type === 'getArtifactGraph') {
          // Verify waitForExecution parameter is passed through
          expect(request.params?.waitForExecution).toBe(true)
          return {
            type: request.type,
            id: request.id,
            timestamp: Date.now(),
            success: true,
            data: [],
          }
        }
        return {
          type: request.type,
          id: request.id,
          timestamp: Date.now(),
          success: false,
          error: 'Unknown request type',
        }
      }
    )

    await registerTools(server)

    const handler = server['_requestHandlers'].get('tools/call')
    expect(handler).toBeDefined()

    if (handler) {
      // Test with default (should be true)
      const response1 = await handler({
        method: 'tools/call',
        params: {
          name: 'get_artifact_graph',
          arguments: {},
        },
      } as Parameters<typeof handler>[0])
      expect(response1).toHaveProperty('content')

      // Test with explicit true
      const response2 = await handler({
        method: 'tools/call',
        params: {
          name: 'get_artifact_graph',
          arguments: { waitForExecution: true },
        },
      } as Parameters<typeof handler>[0])
      expect(response2).toHaveProperty('content')

      // Test with explicit false
      testServer.setHandler(
        async (request: BridgeRequest): Promise<BridgeResponse> => {
          if (request.type === 'getArtifactGraph') {
            expect(request.params?.waitForExecution).toBe(false)
            return {
              type: request.type,
              id: request.id,
              timestamp: Date.now(),
              success: true,
              data: [],
            }
          }
          return {
            type: request.type,
            id: request.id,
            timestamp: Date.now(),
            success: false,
            error: 'Unknown request type',
          }
        }
      )

      const response3 = await handler({
        method: 'tools/call',
        params: {
          name: 'get_artifact_graph',
          arguments: { waitForExecution: false },
        },
      } as Parameters<typeof handler>[0])
      expect(response3).toHaveProperty('content')
    }
  })

  it('should handle waitForExecution parameter for get_feature_tree', async () => {
    testServer.setHandler(
      async (request: BridgeRequest): Promise<BridgeResponse> => {
        if (request.type === 'getFeatureTree') {
          expect(request.params?.waitForExecution).toBe(true)
          return {
            type: request.type,
            id: request.id,
            timestamp: Date.now(),
            success: true,
            data: { operations: [] },
          }
        }
        return {
          type: request.type,
          id: request.id,
          timestamp: Date.now(),
          success: false,
          error: 'Unknown request type',
        }
      }
    )

    await registerTools(server)

    const handler = server['_requestHandlers'].get('tools/call')
    expect(handler).toBeDefined()

    if (handler) {
      const response = await handler({
        method: 'tools/call',
        params: {
          name: 'get_feature_tree',
          arguments: { waitForExecution: true },
        },
      } as Parameters<typeof handler>[0])
      expect(response).toHaveProperty('content')
    }
  })

  it('should handle waitForExecution parameter for get_current_selection', async () => {
    testServer.setHandler(
      async (request: BridgeRequest): Promise<BridgeResponse> => {
        if (request.type === 'getCurrentSelection') {
          expect(request.params?.waitForExecution).toBe(false)
          return {
            type: request.type,
            id: request.id,
            timestamp: Date.now(),
            success: true,
            data: { graphSelections: [], otherSelections: [] },
          }
        }
        return {
          type: request.type,
          id: request.id,
          timestamp: Date.now(),
          success: false,
          error: 'Unknown request type',
        }
      }
    )

    await registerTools(server)

    const handler = server['_requestHandlers'].get('tools/call')
    expect(handler).toBeDefined()

    if (handler) {
      const response = await handler({
        method: 'tools/call',
        params: {
          name: 'get_current_selection',
          arguments: { waitForExecution: false },
        },
      } as Parameters<typeof handler>[0])
      expect(response).toHaveProperty('content')
    }
  })

  it('should throw error for unknown tool', async () => {
    await registerTools(server)

    const handler = server['_requestHandlers'].get('tools/call')
    expect(handler).toBeDefined()

    if (handler) {
      await expect(
        handler({
          method: 'tools/call',
          params: {
            name: 'unknown_tool',
            arguments: {},
          },
        } as Parameters<typeof handler>[0])
      ).rejects.toThrow('Unknown tool: unknown_tool')
    }
  })
})
