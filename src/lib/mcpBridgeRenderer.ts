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
import {
  kclManager,
  rustContext,
  settingsActor,
  sceneInfra,
  engineCommandManager,
} from '@src/lib/singletons'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { err } from '@src/lib/trap'
import { createSelectionFromArtifacts } from '@src/lib/testHelpers'
import { getArtifactOfTypes } from '@src/lang/std/artifactGraph'
import { PATHS, getFilePathRelativeToProject } from '@src/lib/paths'
import type { StatusData } from '@src/mcp-server/types'
import screenshot from '@src/lib/screenshot'
import { engineViewIsometric, engineStreamZoomToFit } from '@src/lib/utils'
import type { CameraViewState } from '@kittycad/lib'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { isArray, uuidv4 } from '@src/lib/utils'
import kclSamplesManifest from '@public/kcl-samples/manifest.json'
import type { FileEntry } from '@src/lib/project'
import { systemIOActor } from '@src/lib/singletons'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'

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

    // Handle getArtifactGraphMermaid request
    window.electron.mcpBridge.onGetArtifactGraphMermaid(
      async (data: { requestId: string; waitForExecution?: boolean }) => {
        try {
          await waitForExecutionIfNeeded(data.waitForExecution ?? true)
          const wasmInstance = await kclManager.wasmInstancePromise

          // Check if function exists
          if (
            !wasmInstance.artifact_graph_to_mermaid ||
            typeof wasmInstance.artifact_graph_to_mermaid !== 'function'
          ) {
            const availableFunctions = Object.keys(wasmInstance).filter(
              (key) => typeof wasmInstance[key] === 'function'
            )
            console.error(
              '[MCP Bridge] artifact_graph_to_mermaid not found. Available functions:',
              availableFunctions.slice(0, 20)
            )
            throw new Error(
              'artifact_graph_to_mermaid function not found on WASM instance. The WASM module may need to be rebuilt with `npm run build:wasm`.'
            )
          }

          // Convert Map back to Rust format (object with map property)
          // Note: We need to remove pathToNode fields that were added in TypeScript,
          // as Rust expects path_to_node to be omitted (it has #[serde(default)] and will use empty Vec<()>)
          const cleanArtifactForRust = (artifact: unknown): unknown => {
            if (!artifact || typeof artifact !== 'object') {
              return artifact
            }
            const cleaned = JSON.parse(JSON.stringify(artifact))
            // Delete pathToNode from codeRef - Rust will use default (empty Vec<()>)
            if (cleaned?.codeRef && 'pathToNode' in cleaned.codeRef) {
              delete cleaned.codeRef.pathToNode
            }
            // Delete pathToNode from faceCodeRef for Wall/Cap artifacts
            if (cleaned?.faceCodeRef && 'pathToNode' in cleaned.faceCodeRef) {
              delete cleaned.faceCodeRef.pathToNode
            }
            return cleaned
          }

          const rustArtifactGraphMap: Record<string, unknown> = {}
          for (const [id, artifact] of kclManager.artifactGraph.entries()) {
            rustArtifactGraphMap[id] = cleanArtifactForRust(artifact)
          }

          const rustArtifactGraph = {
            map: rustArtifactGraphMap,
            itemCount: kclManager.artifactGraph.size,
          }

          // Serialize to JSON and call WASM function
          const artifactGraphJson = JSON.stringify(rustArtifactGraph)
          console.log(
            '[MCP Bridge] Calling artifact_graph_to_mermaid with graph size:',
            kclManager.artifactGraph.size
          )
          // Log a sample artifact to debug structure
          const firstArtifactId = Object.keys(rustArtifactGraphMap)[0]
          if (firstArtifactId) {
            console.log(
              '[MCP Bridge] Sample artifact structure:',
              JSON.stringify(
                rustArtifactGraphMap[firstArtifactId],
                null,
                2
              ).substring(0, 500)
            )
          }

          let mermaidDiagram: string
          try {
            mermaidDiagram =
              wasmInstance.artifact_graph_to_mermaid(artifactGraphJson)
          } catch (wasmError) {
            console.error(
              '[MCP Bridge] WASM function threw error:',
              wasmError,
              'Graph JSON length:',
              artifactGraphJson.length
            )
            throw new Error(
              `WASM function error: ${wasmError instanceof Error ? wasmError.message : String(wasmError)}`
            )
          }

          if (!mermaidDiagram || typeof mermaidDiagram !== 'string') {
            console.error(
              '[MCP Bridge] Unexpected return type:',
              typeof mermaidDiagram,
              'value:',
              mermaidDiagram
            )
            throw new Error(
              `Unexpected return type from artifact_graph_to_mermaid: ${typeof mermaidDiagram}, got: ${String(mermaidDiagram).substring(0, 100)}`
            )
          }

          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            data: mermaidDiagram,
          })
        } catch (error) {
          console.error('[MCP Bridge] Error in getArtifactGraphMermaid:', error)
          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            error:
              error instanceof Error
                ? error.message
                : `Unknown error: ${String(error)}`,
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

    // Handle getScreenshot request
    window.electron.mcpBridge.onGetScreenshot(
      async (data: {
        requestId: string
        view?: string
        waitForExecution?: boolean
        entityIds?: string[]
      }) => {
        try {
          await waitForExecutionIfNeeded(data.waitForExecution ?? true)

          const view =
            (data.view as
              | 'Top view'
              | 'Bottom view'
              | 'Rear view'
              | 'Front view'
              | 'Right view'
              | 'Left view'
              | 'Isometric view'
              | 'Current view') || 'Isometric view'

          // Save current camera state if we need to change view
          let savedCameraState: CameraViewState | null = null
          if (view !== 'Current view') {
            const response = await engineCommandManager.sendSceneCommand({
              type: 'modeling_cmd_req',
              cmd_id: uuidv4(),
              cmd: { type: 'default_camera_get_view' },
            })
            const singleResponse = isArray(response) ? response[0] : response
            if (
              singleResponse &&
              isModelingResponse(singleResponse) &&
              'modeling_response' in singleResponse.resp.data
            ) {
              const modelingResponse =
                singleResponse.resp.data.modeling_response
              if (
                'data' in modelingResponse &&
                modelingResponse.type === 'default_camera_get_view'
              ) {
                savedCameraState = modelingResponse.data.view
              }
            }
          }

          try {
            // Change camera to requested view
            if (view !== 'Current view') {
              if (view === 'Isometric view') {
                await engineViewIsometric({
                  engineCommandManager,
                  padding: 0.1,
                })
                // Wait for initial zoom to complete
                // await new Promise((resolve) => setTimeout(resolve, 400))
                // If entityIds provided, zoom to fit those entities
                if (data.entityIds && data.entityIds.length > 0) {
                  await engineStreamZoomToFit({
                    engineCommandManager,
                    padding: 0.1,
                    objectIds: data.entityIds,
                  })
                  // Wait for zoom to fit specific entities to complete
                  await new Promise((resolve) => setTimeout(resolve, 1000))
                }
              } else {
                // Map view names to axis names
                const axisMap: Record<
                  | 'Top view'
                  | 'Bottom view'
                  | 'Rear view'
                  | 'Front view'
                  | 'Right view'
                  | 'Left view',
                  'x' | 'y' | 'z' | '-x' | '-y' | '-z'
                > = {
                  'Top view': 'z',
                  'Bottom view': '-z',
                  'Front view': '-y',
                  'Rear view': 'y',
                  'Right view': 'x',
                  'Left view': '-x',
                }
                const axis = axisMap[view]
                await sceneInfra.camControls.updateCameraToAxis(axis)
                // Wait for camera axis change to complete
                await new Promise((resolve) => setTimeout(resolve, 400))
                // Zoom to fit after changing view direction
                // If entityIds provided, zoom to fit those entities; otherwise zoom to all
                await engineStreamZoomToFit({
                  engineCommandManager,
                  padding: 0.1,
                  objectIds: data.entityIds,
                })
                // Wait for zoom to fit to complete
                await new Promise((resolve) => setTimeout(resolve, 500))
              }
            } else if (data.entityIds && data.entityIds.length > 0) {
              // If Current view but entityIds provided, zoom to fit those entities
              await engineStreamZoomToFit({
                engineCommandManager,
                padding: 0.1,
                objectIds: data.entityIds,
              })
              // Wait for zoom to fit to complete
              await new Promise((resolve) => setTimeout(resolve, 500))
            }

            // Take screenshot
            const screenshotDataUrl = await screenshot()

            // Restore camera state if we changed it
            if (savedCameraState && view !== 'Current view') {
              await engineCommandManager.sendSceneCommand({
                type: 'modeling_cmd_req',
                cmd_id: uuidv4(),
                cmd: {
                  type: 'default_camera_set_view',
                  view: savedCameraState,
                },
              })
              // Trigger camera sync
              await engineCommandManager.sendSceneCommand({
                type: 'modeling_cmd_req',
                cmd_id: uuidv4(),
                cmd: {
                  type: 'default_camera_get_settings',
                },
              })
            }

            window.electron?.mcpBridge?.sendResponse(data.requestId, {
              data: screenshotDataUrl,
            })
          } catch (screenshotError) {
            // Always try to restore camera even if screenshot fails
            if (savedCameraState && view !== 'Current view') {
              try {
                await engineCommandManager.sendSceneCommand({
                  type: 'modeling_cmd_req',
                  cmd_id: uuidv4(),
                  cmd: {
                    type: 'default_camera_set_view',
                    view: savedCameraState,
                  },
                })
              } catch (restoreError) {
                console.error(
                  '[MCP Bridge Renderer] Failed to restore camera after screenshot error:',
                  restoreError
                )
              }
            }
            window.electron?.mcpBridge?.sendResponse(data.requestId, {
              error:
                screenshotError instanceof Error
                  ? screenshotError.message
                  : 'Unknown error',
            })
            return
          }
        } catch (error) {
          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    )

    // Helper function to recursively collect all KCL files from FileEntry tree
    const collectKclFiles = (
      entry: FileEntry,
      projectPath: string,
      projectName: string,
      currentFilePath: string | null
    ): Array<{
      path: string
      name: string
      isEntryFile: boolean
      size?: number
      modified?: number
    }> => {
      const files: Array<{
        path: string
        name: string
        isEntryFile: boolean
        size?: number
        modified?: number
      }> = []

      // If this is a file (children is null) and it's a .kcl file
      if (entry.children === null && entry.name.endsWith('.kcl')) {
        const relativePath = getFilePathRelativeToProject(
          entry.path,
          projectName,
          window.electron?.sep
        )
        files.push({
          path: relativePath,
          name: entry.name,
          isEntryFile: entry.path === currentFilePath,
        })
      } else if (entry.children) {
        // If this is a directory, recurse into children
        for (const child of entry.children) {
          files.push(
            ...collectKclFiles(child, projectPath, projectName, currentFilePath)
          )
        }
      }

      return files
    }

    // Handle getKclFileNames request
    window.electron.mcpBridge.onGetKclFileNames(
      async (data: { requestId: string }) => {
        try {
          const currentProjectFromSettings =
            settingsActor.getSnapshot().context.currentProject
          const currentFilePath = kclManager.currentFilePath

          if (!currentProjectFromSettings) {
            window.electron?.mcpBridge?.sendResponse(data.requestId, {
              error: 'No project is currently loaded',
            })
            return
          }

          // Get the full project with children from systemIO actor's folders
          // The settings actor's currentProject might not have children populated
          const systemIOSnapshot = systemIOActor.getSnapshot()
          const folders = systemIOSnapshot.context.folders
          const fullProject = folders.find(
            (p) => p.name === currentProjectFromSettings.name
          )

          // Use the full project if available, otherwise fall back to settings project
          const currentProject = fullProject || currentProjectFromSettings

          // Collect files from all children of the project
          const files: Array<{
            path: string
            name: string
            isEntryFile: boolean
            size?: number
            modified?: number
          }> = []

          if (currentProject.children && currentProject.children.length > 0) {
            for (const child of currentProject.children) {
              files.push(
                ...collectKclFiles(
                  child,
                  currentProject.path,
                  currentProject.name,
                  currentFilePath
                )
              )
            }
          }

          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            data: files,
          })
        } catch (error) {
          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    )

    // Handle getCurrentKclFile request
    window.electron.mcpBridge.onGetCurrentKclFile(
      async (data: { requestId: string }) => {
        try {
          const currentProject =
            settingsActor.getSnapshot().context.currentProject
          const currentFilePath = kclManager.currentFilePath

          if (!currentProject || !currentFilePath) {
            window.electron?.mcpBridge?.sendResponse(data.requestId, {
              data: null,
            })
            return
          }

          const relativePath = getFilePathRelativeToProject(
            currentFilePath,
            currentProject.name,
            window.electron?.sep
          )

          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            data: relativePath,
          })
        } catch (error) {
          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    )

    // Handle setCurrentKclFile request
    window.electron.mcpBridge.onSetCurrentKclFile(
      async (data: { requestId: string; filePath: string }) => {
        try {
          const currentProject =
            settingsActor.getSnapshot().context.currentProject

          if (!currentProject) {
            window.electron?.mcpBridge?.sendResponse(data.requestId, {
              error: 'No project is currently loaded',
            })
            return
          }

          // Convert relative path to absolute path
          const sep = window.electron?.sep || '/'
          const absolutePath = data.filePath.startsWith(sep)
            ? data.filePath
            : `${currentProject.path}${sep}${data.filePath}`

          // Validate file exists (if electron is available)
          if (window.electron) {
            try {
              await window.electron.stat(absolutePath)
            } catch {
              window.electron?.mcpBridge?.sendResponse(data.requestId, {
                error: `File not found: ${data.filePath}`,
              })
              return
            }
          }

          // Navigate to the file using systemIOActor
          systemIOActor.send({
            type: SystemIOMachineEvents.navigateToFile,
            data: {
              requestedProjectName: currentProject.name,
              requestedFileName: data.filePath,
            },
          })

          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            data: { success: true, filePath: data.filePath },
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

    // Handle listKclSamples request
    window.electron.mcpBridge.onListKclSamples(
      async (data: { requestId: string }) => {
        try {
          // Return the manifest data with structured information
          const samples = kclSamplesManifest.map((sample) => ({
            name: sample.pathFromProjectDirectoryToFirstFile.replace(
              '/main.kcl',
              ''
            ),
            title: sample.title,
            description: sample.description,
            categories: sample.categories,
            pathFromProjectDirectoryToFirstFile:
              sample.pathFromProjectDirectoryToFirstFile,
            multipleFiles: sample.multipleFiles,
            files: sample.files,
          }))
          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            data: samples,
          })
        } catch (error) {
          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    )

    // Handle getKclSample request
    window.electron.mcpBridge.onGetKclSample(
      async (data: {
        requestId: string
        sampleName: string
        fileName?: string
      }) => {
        try {
          // TypeScript guard: we know window.electron exists from outer check
          const electron = window.electron
          if (!electron) {
            return
          }

          // Find the sample in the manifest
          const sample = kclSamplesManifest.find(
            (s) =>
              s.pathFromProjectDirectoryToFirstFile.replace('/main.kcl', '') ===
              data.sampleName
          )

          if (!sample) {
            electron.mcpBridge?.sendResponse(data.requestId, {
              error: `Sample "${data.sampleName}" not found. Use list_kcl_samples to see available samples.`,
            })
            return
          }

          // Determine which file to read (default to main.kcl)
          const fileName = data.fileName || 'main.kcl'

          // Validate that the file exists in the sample's files list
          if (!sample.files.includes(fileName)) {
            electron.mcpBridge?.sendResponse(data.requestId, {
              error: `File "${fileName}" not found in sample "${data.sampleName}". Available files: ${sample.files.join(', ')}`,
            })
            return
          }

          // Construct the path to the requested file
          // The sample path is relative to kcl-samples/ directory
          const sampleDir = sample.pathFromProjectDirectoryToFirstFile.replace(
            '/main.kcl',
            ''
          )
          const filePath = `kcl-samples/${sampleDir}/${fileName}`

          // Try to read the file from different possible locations
          // In development: files are at project root/public/kcl-samples
          // In production: files are bundled, need to find the right path
          let fileContent: string
          try {
            // Get the app path to construct the full path
            const appPath = await electron.getAppPath()

            // Try different possible paths
            const possiblePaths = [
              // Development: project root/public/kcl-samples/...
              electron.path.join(appPath, '..', '..', 'public', filePath),
              // Development: alternative structure
              electron.path.join(appPath, '..', 'public', filePath),
              // Production: packaged app
              electron.path.join(appPath, 'public', filePath),
              // Production: resources folder (Electron packaging)
              electron.path.join(
                appPath,
                '..',
                'resources',
                'public',
                filePath
              ),
            ]

            let fullFilePath: string | null = null
            for (const path of possiblePaths) {
              if (electron.exists(path)) {
                fullFilePath = path
                break
              }
            }

            if (!fullFilePath) {
              electron.mcpBridge?.sendResponse(data.requestId, {
                error: `Could not find sample file "${filePath}" at any expected location. Sample: ${data.sampleName}, File: ${fileName}`,
              })
              return
            }

            // Read file with utf-8 encoding to get string directly
            fileContent = await electron.readFile(fullFilePath, {
              encoding: 'utf-8',
            })
          } catch (fileError) {
            electron.mcpBridge?.sendResponse(data.requestId, {
              error:
                fileError instanceof Error
                  ? fileError.message
                  : 'Failed to read sample file',
            })
            return
          }

          electron.mcpBridge?.sendResponse(data.requestId, {
            data: {
              name: data.sampleName,
              fileName: fileName,
              title: sample.title,
              description: sample.description,
              categories: sample.categories,
              content: fileContent,
              path: `${sampleDir}/${fileName}`,
              availableFiles: sample.files,
            },
          })
        } catch (error) {
          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    )

    // Handle setEntityHighlight request
    window.electron.mcpBridge.onSetEntityHighlight(
      async (data: { requestId: string; entityIds: string[] }) => {
        try {
          if (!data.entityIds || data.entityIds.length === 0) {
            window.electron?.mcpBridge?.sendResponse(data.requestId, {
              error: 'At least one entity ID is required',
            })
            return
          }

          // Send select_add command to engine to highlight entities
          await engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd: {
              type: 'select_add',
              entities: data.entityIds,
            },
            cmd_id: uuidv4(),
          })

          window.electron?.mcpBridge?.sendResponse(data.requestId, {
            data: {
              success: true,
              highlightedCount: data.entityIds.length,
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
