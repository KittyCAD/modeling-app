import { isArray } from '@src/lib/utils'
import { getOperationVariableName } from '@src/lib/operations'
import type { EngineCommandManager } from '@src/lang/std/engineConnection'
import type { KclManager } from '@src/lang/KclSingleton'
import {
  findOperationPlaneArtifact,
  type StdLibCallOp,
} from '@src/lang/queryAst'

// Exports a sketch operation to DXF format
export async function exportSketchToDxf(
  operation: StdLibCallOp,
  dependencies: {
    engineCommandManager: EngineCommandManager
    kclManager: KclManager
    toast: {
      error: (message: string, options?: any) => void
      loading: (message: string) => string
      success: (message: string, options?: any) => void
      dismiss: (toastId: string) => void
    }
    uuidv4: () => string
    base64Decode: (input: string) => ArrayBuffer | Error
    browserSaveFile: (
      blob: Blob,
      filename: string,
      toastId: string
    ) => Promise<void>
  }
): Promise<{ success: boolean; error?: string }> {
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
    // Get the plane artifact associated with this sketch operation
    const planeArtifact = findOperationPlaneArtifact(
      operation,
      kclManager.artifactGraph
    )

    if (!planeArtifact || planeArtifact.type !== 'plane') {
      toast.error('Could not find sketch for DXF export')
      return { success: false, error: 'Could not find plane artifact' }
    }

    // Early exit if no path IDs to process
    if (!('pathIds' in planeArtifact) || !planeArtifact.pathIds?.length) {
      toast.error('Could not find sketch profiles for DXF export')
      return { success: false, error: 'Could not find path IDs' }
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
      return { success: false, error: 'Could not find sketch entities' }
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

    if (
      response &&
      !isArray(response) &&
      response.success &&
      'resp' in response &&
      response.resp &&
      'data' in response.resp &&
      response.resp.data &&
      'modeling_response' in response.resp.data &&
      response.resp.data.modeling_response &&
      typeof response.resp.data.modeling_response === 'object' &&
      'type' in response.resp.data.modeling_response &&
      response.resp.data.modeling_response.type === 'export2d' &&
      'data' in response.resp.data.modeling_response &&
      response.resp.data.modeling_response.data &&
      typeof response.resp.data.modeling_response.data === 'object' &&
      'files' in response.resp.data.modeling_response.data
    ) {
      const modelingResponse = response.resp.data.modeling_response as {
        type: 'export2d'
        data: {
          files: Array<{ contents: string }> | undefined
        }
      }
      const files = modelingResponse.data.files

      if (
        !files ||
        !isArray(files) ||
        files.length === 0 ||
        !files[0]?.contents
      ) {
        console.error('DXF export failed: no files or empty contents')
        toast.error('Failed to export sketch to DXF', { id: toastId })
        return { success: false, error: 'Engine command failed' }
      }

      // Decode (handle throws or Error return)
      let decodedBuf: ArrayBuffer
      try {
        const decoded = base64Decode(files[0].contents)
        if (decoded instanceof Error) {
          console.error('Base64 decode failed:', decoded)
          toast.error('Failed to decode DXF file data', { id: toastId })
          return { success: false, error: 'Base64 decode failed' }
        }
        decodedBuf = decoded
      } catch (e) {
        console.error('Base64 decode failed:', e)
        toast.error('Failed to decode DXF file data', { id: toastId })
        return { success: false, error: 'Base64 decode failed' }
      }

      const uint8Array = new Uint8Array(decodedBuf)

      // Generate meaningful filename from sketch name
      const sketchName = getOperationVariableName(operation, kclManager.ast)
      const fileName = `${sketchName || 'sketch'}.dxf`

      if (window.electron) {
        if (window.electron.process.env.NODE_ENV === 'test') {
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
              uint8Array
            )
          } catch (e: any) {
            console.error('Write file failed:', e)
            toast.error('Failed to save file', { id: toastId })
            return { success: false, error: e?.message ?? 'Write failed' }
          }

          toast.success('DXF export completed [TEST]', { id: toastId })
          return { success: true }
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
          return { success: false, error: 'User canceled save' }
        }

        try {
          await window.electron.writeFile(filePathMeta.filePath, uint8Array)
        } catch (e: any) {
          console.error('Write file failed:', e)
          toast.error('Failed to save file', { id: toastId })
          return { success: false, error: e?.message ?? 'Write failed' }
        }

        toast.success('DXF export completed', { id: toastId })
        return { success: true }
      } else {
        // Browser: download file
        const blob = new Blob([uint8Array], {
          type: 'application/dxf',
        })
        await browserSaveFile(blob, fileName, toastId)
        return { success: true }
      }
    } else {
      console.error('DXF export failed:', response)
      toast.error('Failed to export sketch to DXF', { id: toastId })
      return { success: false, error: 'Engine command failed' }
    }
  } catch (error: any) {
    console.error('DXF export error:', error)
    if (toastId) {
      toast.error('Failed to export sketch to DXF', { id: toastId })
    } else {
      toast.error('Failed to export sketch to DXF')
    }
    return { success: false, error: error?.message ?? 'Unknown error' }
  }
}
