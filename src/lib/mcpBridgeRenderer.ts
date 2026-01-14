/**
 * MCP Bridge Renderer Handlers
 *
 * Handles IPC requests from main process for MCP bridge queries
 * This allows the MCP server (via main process) to query app state
 */

import { effect } from '@preact/signals-core'

import { addFillet } from '@src/lang/modifyAst/edges'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import { EXECUTION_TYPE_REAL } from '@src/lib/constants'
import { kclManager, rustContext, settingsActor } from '@src/lib/singletons'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { err } from '@src/lib/trap'
import { createSelectionFromArtifacts } from '@src/lib/testHelpers'
import { getArtifactOfTypes } from '@src/lang/std/artifactGraph'
import { PATHS } from '@src/lib/paths'
import type { StatusData } from '@src/mcp-server/types'

/**
 * Wait for execution to complete if it's currently in progress
 * Uses signal subscription for reactive waiting instead of polling
 * @param waitForExecution - Whether to wait for execution (defaults to true)
 * @param maxWaitTime - Maximum time to wait in milliseconds (defaults to 60 seconds)
 */
async function waitForExecutionIfNeeded(
  waitForExecution: boolean = true,
  maxWaitTime: number = 60000
): Promise<void> {
  if (!waitForExecution) {
    return
  }

  // If not executing, return immediately
  if (!kclManager.isExecuting) {
    return
  }

  // Use Preact signal effect to reactively wait for execution to complete
  return new Promise<void>((resolve) => {
    let timeoutId: NodeJS.Timeout | null = null
    let disposeEffect: (() => void) | null = null

    // Set up timeout as a safety mechanism
    timeoutId = setTimeout(() => {
      if (disposeEffect) {
        disposeEffect()
      }
      console.warn(
        '[MCP Bridge Renderer] Timeout waiting for execution to complete'
      )
      resolve()
    }, maxWaitTime)

    // Use effect() to reactively watch the signal - callback fires whenever the value changes
    disposeEffect = effect(() => {
      // Access the signal value to track it
      const isExecuting = kclManager.isExecutingSignal.value

      // When execution completes (isExecuting becomes false), resolve
      if (!isExecuting) {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        if (disposeEffect) {
          disposeEffect()
        }
        resolve()
      }
    })
  })
}

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
      async (data: { requestId: string; waitForExecution?: boolean }) => {
        try {
          await waitForExecutionIfNeeded(data.waitForExecution ?? true)
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
      async (data: { requestId: string; waitForExecution?: boolean }) => {
        try {
          await waitForExecutionIfNeeded(data.waitForExecution ?? true)
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
      async (data: { requestId: string; waitForExecution?: boolean }) => {
        try {
          await waitForExecutionIfNeeded(data.waitForExecution ?? true)
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

    // Handle getStatus request
    window.electron.mcpBridge.onGetStatus(
      async (data: { requestId: string; waitForExecution?: boolean }) => {
        try {
          await waitForExecutionIfNeeded(data.waitForExecution ?? false)
          const diagnostics = kclManager.diagnostics.map((d) => ({
            from: d.from,
            to: d.to,
            message: d.message,
            severity: d.severity,
          }))

          // Get project name from settings
          const currentProject =
            settingsActor.getSnapshot().context.currentProject
          const projectName = currentProject?.name || null

          // Check if on home screen
          // In Electron (desktop), routing uses hash: window.location.hash (e.g., "#/home")
          // In browser, routing uses pathname: window.location.pathname (e.g., "/home")
          const hash = window.location.hash || ''
          const pathname = window.location.pathname || ''
          const isOnHomeScreen =
            hash.startsWith(`#${PATHS.HOME}`) || pathname === PATHS.HOME

          const statusData: StatusData = {
            isExecuting: kclManager.isExecuting,
            diagnostics,
            projectName,
            ...(isOnHomeScreen && { isOnHomeScreen: true }),
          }
          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            data: statusData,
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

          // Get selection: either from provided edge IDs or current selection
          let selection: typeof kclManager.selectionRanges
          if (data.edges && data.edges.length > 0) {
            // Autonomous mode: convert edge IDs to selections
            const edgeArtifacts = []
            for (const edgeId of data.edges) {
              const artifact = getArtifactOfTypes(
                { key: edgeId, types: ['segment', 'sweepEdge'] },
                artifactGraph
              )
              if (err(artifact)) {
                window.electron?.mcpBridge?.sendResponse(data.requestId, {
                  error: `Edge with ID ${edgeId} not found or is not a valid edge type (segment or sweepEdge).`,
                })
                return
              }
              edgeArtifacts.push(artifact)
            }

            if (edgeArtifacts.length === 0) {
              window.electron?.mcpBridge?.sendResponse(data.requestId, {
                error: 'No valid edge artifacts found from provided IDs.',
              })
              return
            }

            selection = createSelectionFromArtifacts(
              edgeArtifacts,
              artifactGraph
            )
          } else {
            // Convenience mode: use current selection
            selection = kclManager.selectionRanges

            // Validate selection has edges
            if (
              !selection.graphSelections ||
              selection.graphSelections.length === 0
            ) {
              window.electron?.mcpBridge?.sendResponse(data.requestId, {
                error:
                  'No edges selected. Please select edges in the app before calling fillet_edge, or provide edge IDs in the edges parameter.',
              })
              return
            }
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
