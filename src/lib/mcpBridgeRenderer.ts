/**
 * MCP Bridge Renderer Handlers
 *
 * Handles IPC requests from main process for MCP bridge queries
 * This allows the MCP server (via main process) to query app state
 */

import { addFillet } from '@src/lang/modifyAst/edges'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import { EXECUTION_TYPE_REAL } from '@src/lib/constants'
import { kclManager, rustContext } from '@src/lib/singletons'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { err } from '@src/lib/trap'

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

    // Handle filletEdge request
    window.electron.mcpBridge.onFilletEdge(
      async (data: {
        requestId: string
        radius: string
        tag?: string
        useCurrentSelection?: boolean
        edges?: string[]
      }) => {
        try {
          // Get current AST and artifact graph
          const ast = kclManager.ast
          const artifactGraph = kclManager.artifactGraph
          const wasmInstance = await kclManager.wasmInstancePromise

          // Get selection
          let selection = kclManager.selectionRanges
          if (!data.useCurrentSelection && data.edges) {
            // TODO: Convert edge IDs to selections
            // For now, we'll use current selection
            // This is a limitation - we'd need to look up artifacts by ID
            window.electron?.mcpBridge?.sendResponse(data.requestId, {
              error:
                'Using edge IDs directly is not yet supported. Please use current selection.',
            })
            return
          }

          // Validate selection has edges
          if (
            !selection.graphSelections ||
            selection.graphSelections.length === 0
          ) {
            window.electron?.mcpBridge?.sendResponse(data.requestId, {
              error:
                'No edges selected. Please select edges in the app before calling fillet_edge.',
            })
            return
          }

          // Convert radius string to KclCommandValue
          const radiusKcl = await stringToKclExpression(
            data.radius,
            rustContext
          )
          if (err(radiusKcl) || 'errors' in radiusKcl) {
            window.electron?.mcpBridge?.sendResponse(data.requestId, {
              error: `Invalid radius value: ${data.radius}. Please provide a valid number or KCL expression.`,
            })
            return
          }

          // Call addFillet
          const filletResult = addFillet({
            ast,
            artifactGraph,
            selection,
            radius: radiusKcl,
            tag: data.tag,
            wasmInstance,
          })

          if (err(filletResult)) {
            window.electron?.mcpBridge?.sendResponse(data.requestId, {
              error:
                filletResult instanceof Error
                  ? filletResult.message
                  : 'Failed to create fillet',
            })
            return
          }

          // Update the modeling state with the modified AST
          await updateModelingState(
            filletResult.modifiedAst,
            EXECUTION_TYPE_REAL,
            {
              kclManager,
              rustContext,
            },
            {
              focusPath: filletResult.pathToNode,
            }
          )

          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            data: {
              success: true,
              pathToNode: filletResult.pathToNode,
              message: 'Fillet operation completed successfully',
            },
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
