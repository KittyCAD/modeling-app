import { isArray } from '@src/lib/utils'
import { getOperationVariableName } from '@src/lib/operations'
import type { KclManager } from '@src/lang/KclManager'
import {
  findOperationPlaneLikeArtifact,
  type StdLibCallOp,
} from '@src/lang/queryAst'
import type { WebSocketResponse } from '@kittycad/lib'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import type { ToastOptions } from 'react-hot-toast'
import type { ConnectionManager } from '@src/network/connectionManager'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Artifact } from '@src/lang/std/artifactGraph'

// Helper function to find the plane artifact for a subtract2d operation
// by traversing the artifact graph to find which plane contains the sketch's paths
function findPlaneArtifactForSubtract2d(
  operation: StdLibCallOp,
  kclManager: KclManager
): Artifact | null {
  const subtract2dNodePath = operation.nodePath
  if (!subtract2dNodePath.steps || subtract2dNodePath.steps.length < 2) {
    return null
  }
  // Get the root of the subtract2d's nodePath (identifies the variable/pipe)
  const subtract2dRoot = JSON.stringify(subtract2dNodePath.steps.slice(0, 2))

  // Find all path artifacts that share the same root - these are the sketch's paths
  const sketchPathIds: string[] = []
  for (const artifact of kclManager.artifactGraph.values()) {
    if (artifact.type !== 'path') continue

    const pathNodePath = artifact.codeRef?.nodePath
    if (!pathNodePath?.steps || pathNodePath.steps.length < 2) continue

    const pathRoot = JSON.stringify(pathNodePath.steps.slice(0, 2))
    if (pathRoot === subtract2dRoot) {
      sketchPathIds.push(artifact.id)
    }
  }

  if (sketchPathIds.length === 0) {
    return null
  }

  // Find which plane contains these paths by checking plane.pathIds
  for (const artifact of kclManager.artifactGraph.values()) {
    if (artifact.type !== 'plane') continue
    if (!('pathIds' in artifact) || !isArray(artifact.pathIds)) continue

    // Check if this plane contains any of the sketch's paths
    const containsSketchPath = sketchPathIds.some((pathId) =>
      artifact.pathIds.includes(pathId)
    )

    if (containsSketchPath) {
      return artifact
    }
  }

  return null
}

// Exports a sketch operation to DXF format
export async function exportSketchToDxf(
  operation: StdLibCallOp,
  dependencies: {
    engineCommandManager: ConnectionManager
    kclManager: KclManager
    toast: {
      error: (message: string, options?: ToastOptions) => void
      loading: (message: string) => string
      success: (message: string, options?: ToastOptions) => void
      dismiss: (toastId: string) => void
    }
    uuidv4: () => string
    base64Decode: (
      input: string,
      wasmInstance: ModuleType
    ) => ArrayBuffer | Error
    browserSaveFile: (
      blob: Blob,
      filename: string,
      toastId: string
    ) => Promise<void>
  }
): Promise<boolean | Error> {
  const {
    engineCommandManager,
    kclManager,
    toast,
    uuidv4,
    base64Decode,
    browserSaveFile,
  } = dependencies

  let toastId: string | undefined = undefined

  try {
    // For subtract2d operations, find the plane artifact from the same sketch
    let planeArtifact
    if (operation.name === 'subtract2d') {
      planeArtifact = findPlaneArtifactForSubtract2d(operation, kclManager)
      if (!planeArtifact) {
        toast.error('Could not find sketch to export from subtract2d operation')
        return new Error('Could not find plane artifact for subtract2d')
      }
    } else {
      // Get the plane artifact associated with this sketch operation
      planeArtifact = findOperationPlaneLikeArtifact(
        operation,
        kclManager.artifactGraph
      )
    }

    if (!planeArtifact) {
      toast.error('Could not find sketch for DXF export')
      return new Error('Could not find plane artifact')
    }

    // Early exit if no path IDs to process
    if (!('pathIds' in planeArtifact) || !planeArtifact.pathIds?.length) {
      toast.error('Could not find sketch profiles for DXF export')
      return new Error('Could not find path IDs')
    }

    // Get all entity IDs from the plane's paths
    const entityIds: string[] = []
    for (const pathId of planeArtifact.pathIds) {
      const pathArtifact = kclManager.artifactGraph.get(pathId)
      if (!pathArtifact) continue
      if ('compositeSolidId' in pathArtifact && pathArtifact.compositeSolidId) {
        // Sketch has been extruded - use the composite solid ID
        entityIds.push(pathArtifact.compositeSolidId)
      } else {
        // Sketch hasn't been extruded - use the path ID
        entityIds.push(pathId)
      }
    }

    // Deduplicate entity IDs
    const uniqueEntityIds = Array.from(new Set(entityIds))
    if (uniqueEntityIds.length === 0) {
      toast.error('Could not find sketch entities for DXF export')
      return new Error('Could not find sketch entities')
    }

    toastId = toast.loading('Exporting sketch to DXF...')

    // Use the export2d command for DXF export
    const response = await engineCommandManager.sendSceneCommand(
      {
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'export2d',
          entity_ids: uniqueEntityIds,
          format: {
            type: 'dxf',
            storage: 'ascii',
          },
        },
      },
      true
    )

    // Helper function to safely extract files from engine response
    const extractExportFiles = (
      response: WebSocketResponse | [WebSocketResponse] | null
    ): Array<{ name?: string; contents: string }> | null => {
      try {
        // Handle null response
        if (!response) {
          return null
        }

        // Extract single response from array if needed
        const singleResponse = isArray(response) ? response[0] : response

        // Basic response validation
        if (!singleResponse || !isModelingResponse(singleResponse)) {
          return null
        }

        // Navigate to the modeling response
        const modelingResponse = singleResponse.resp.data.modeling_response
        if (modelingResponse?.type !== 'export2d') {
          return null
        }

        // Extract files array
        const files = modelingResponse.data?.files
        if (!isArray(files) || files.length === 0) {
          return null
        }

        return files as Array<{ name?: string; contents: string }>
      } catch {
        return null
      }
    }

    // Helper function to select the best file from multiple files
    const selectBestFile = (
      files: Array<{ name?: string; contents: string }>
    ) => {
      if (files.length === 1) return files[0]

      // Prefer files with 'dxf' extension if available
      const dxfFile = files.find((file) =>
        file.name?.toLowerCase().includes('.dxf')
      )
      return dxfFile || files[0]
    }

    const files = extractExportFiles(response)
    if (!files?.length) {
      console.error('DXF export failed:', response)
      toast.error('Failed to export sketch to DXF', { id: toastId })
      return new Error('Engine command failed')
    }

    const selectedFile = selectBestFile(files)
    if (!selectedFile?.contents) {
      console.error('DXF export failed: no file contents', response)
      toast.error('Failed to export sketch to DXF', { id: toastId })
      return new Error('Engine command failed')
    }

    // Decode (handle throws or Error return)
    let decodedBuf: ArrayBuffer
    try {
      const decoded = base64Decode(
        selectedFile.contents,
        await kclManager.wasmInstancePromise
      )
      if (decoded instanceof Error) {
        console.error('Base64 decode failed:', decoded)
        toast.error('Failed to decode DXF file data', { id: toastId })
        return new Error('Base64 decode failed')
      }
      decodedBuf = decoded
    } catch (e) {
      console.error('Base64 decode failed:', e)
      toast.error('Failed to decode DXF file data', { id: toastId })
      return new Error('Base64 decode failed')
    }

    const decodedData = new Uint8Array(decodedBuf)

    // Generate meaningful filename from sketch name
    const sketchName = getOperationVariableName(
      operation,
      kclManager.ast,
      await kclManager.wasmInstancePromise
    )
    const fileName = `${sketchName || 'sketch'}.dxf`

    if (window.electron) {
      if (window.electron?.process?.env?.NODE_ENV === 'test') {
        // In test environment (Playwright), skip the file picker dialog and save directly
        // to a designated test downloads directory to avoid blocking automated tests
        const testSettingsPath = await window.electron.getAppTestProperty(
          'TEST_SETTINGS_FILE_KEY'
        )
        const downloadDir = window.electron.join(
          testSettingsPath,
          'downloads-during-playwright'
        )
        await window.electron.mkdir(downloadDir, { recursive: true })

        try {
          await window.electron.writeFile(
            window.electron.join(downloadDir, fileName),
            decodedData
          )
        } catch (e: unknown) {
          console.error('Write file failed:', e)
          toast.error('Failed to save file', { id: toastId })
          const message = e instanceof Error ? e.message : 'Write failed'
          return new Error(message)
        }

        toast.success('DXF export completed [TEST]', { id: toastId })
        return true
      }

      const filePathMeta = await window.electron.save({
        defaultPath: fileName,
        filters: [
          {
            name: 'DXF files',
            extensions: ['dxf'],
          },
        ],
      })

      if (filePathMeta.canceled) {
        toast.dismiss(toastId)
        return new Error('User canceled save')
      }

      try {
        await window.electron.writeFile(filePathMeta.filePath, decodedData)
      } catch (e: unknown) {
        console.error('Write file failed:', e)
        toast.error('Failed to save file', { id: toastId })
        const message = e instanceof Error ? e.message : 'Write failed'
        return new Error(message)
      }

      toast.success('DXF export completed', { id: toastId })
      return true
    } else {
      // Browser: download file
      const blob = new Blob([decodedData], {
        type: 'application/dxf',
      })
      await browserSaveFile(blob, fileName, toastId)
      return true
    }
  } catch (error: any) {
    console.error('DXF export error:', error)
    if (toastId) {
      toast.error('Failed to export sketch to DXF', { id: toastId })
    } else {
      toast.error('Failed to export sketch to DXF')
    }
    return new Error(error?.message ?? 'Unknown error')
  }
}
