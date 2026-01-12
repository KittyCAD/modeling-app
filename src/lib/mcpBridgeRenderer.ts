/**
 * MCP Bridge Renderer Handlers
 *
 * Handles IPC requests from main process for MCP bridge queries
 * This allows the MCP server (via main process) to query app state
 */

import { kclManager } from '@src/lib/singletons'

/**
 * Initialize MCP bridge IPC handlers in the renderer
 * Call this when the renderer is ready
 */
export function initMcpBridgeHandlers(): void {
  if (!window.electron?.mcpBridge) {
    console.warn(
      '[MCP Bridge Renderer] MCP bridge not available in electron API'
    )
    return
  }

  try {
    // Handle getArtifactGraph request
    window.electron.mcpBridge.onGetArtifactGraph(
      (data: { requestId: string }) => {
        try {
          // Convert Map to Array for JSON serialization
          const artifactGraphData = Array.from(
            kclManager.artifactGraph.entries()
          )
          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            data: artifactGraphData,
          })
        } catch (error) {
          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    )

    // Handle getFeatureTree request
    window.electron.mcpBridge.onGetFeatureTree(
      (data: { requestId: string }) => {
        try {
          const operations = kclManager.lastSuccessfulOperations || []
          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            data: { operations },
          })
        } catch (error) {
          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    )

    // Handle getCurrentSelection request
    window.electron.mcpBridge.onGetCurrentSelection(
      (data: { requestId: string }) => {
        try {
          const selectionRanges = kclManager.selectionRanges
          const selectionData = {
            graphSelections: selectionRanges.graphSelections,
            otherSelections: selectionRanges.otherSelections,
          }
          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            data: selectionData,
          })
        } catch (error) {
          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    )
  } catch (error) {
    console.error('[MCP Bridge Renderer] Error initializing handlers:', error)
    // Don't throw - allow app to continue even if MCP bridge fails
  }
}
