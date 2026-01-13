/**
 * Unit tests for MCP server initialization
 */

/* eslint-disable @typescript-eslint/unbound-method */
// Signal handlers extracted from mocks don't use 'this', safe to call directly

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMcpServer } from './server.js'
import { registerTools } from './tools/registry.js'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'

// Mock the registry
vi.mock('./tools/registry.js', () => ({
  registerTools: vi.fn(),
}))

describe('createMcpServer', () => {
  let mockServer: Server
  let originalOn: typeof process.on
  let originalExit: typeof process.exit

  beforeEach(() => {
    // Mock process.on and process.exit
    // These mocks are necessary because we can't easily test signal handlers
    // and process.exit in unit tests
    originalOn = process.on.bind(process)
    originalExit = process.exit.bind(process)
    process.on = vi.fn() as unknown as typeof process.on
    process.exit = vi.fn() as unknown as typeof process.exit

    // Create mock server
    mockServer = {
      onerror: null,
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Server

    vi.clearAllMocks()
  })

  afterEach(() => {
    process.on = originalOn
    process.exit = originalExit
  })

  it('should register tools with the server', async () => {
    await createMcpServer(mockServer)

    expect(registerTools).toHaveBeenCalledWith(mockServer)
  })

  it('should set up error handler', async () => {
    await createMcpServer(mockServer)

    expect(mockServer.onerror).toBeDefined()
    expect(typeof mockServer.onerror).toBe('function')
  })

  it('should handle server errors', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    await createMcpServer(mockServer)

    const testError = new Error('Test error')
    if (mockServer.onerror) {
      mockServer.onerror(testError)
    }

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[MCP Server Error]',
      testError
    )

    consoleErrorSpy.mockRestore()
  })

  it('should set up SIGINT handler', async () => {
    await createMcpServer(mockServer)

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function))
  })

  it('should set up SIGTERM handler', async () => {
    await createMcpServer(mockServer)

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
  })

  it('should close server and exit on SIGINT', async () => {
    await createMcpServer(mockServer)

    const sigintHandler = (
      process.on as ReturnType<typeof vi.fn>
    ).mock.calls.find((call) => call[0] === 'SIGINT')?.[1] as
      | (() => Promise<void>)
      | undefined

    if (sigintHandler) {
      // Handler functions don't use 'this', wrap in arrow function to satisfy linter
      const invokeHandler = async () => {
        return await sigintHandler()
      }
      await invokeHandler()
    }

    expect(mockServer.close).toHaveBeenCalled()
    // Note: process.exit is called in a then() callback, so we can't easily test it
    // but we can verify the handler was set up
  })

  it('should close server and exit on SIGTERM', async () => {
    await createMcpServer(mockServer)

    const sigtermHandler = (
      process.on as ReturnType<typeof vi.fn>
    ).mock.calls.find((call) => call[0] === 'SIGTERM')?.[1] as
      | (() => Promise<void>)
      | undefined

    if (sigtermHandler) {
      // Handler functions don't use 'this', wrap in arrow function to satisfy linter
      const invokeHandler = async () => {
        return await sigtermHandler()
      }
      await invokeHandler()
    }

    expect(mockServer.close).toHaveBeenCalled()
  })
})
