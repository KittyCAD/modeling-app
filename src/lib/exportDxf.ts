import type { toast } from 'react-hot-toast'
import type { uuidv4 } from '@src/lib/utils'
import { isArray } from '@src/lib/utils'
import type { base64Decode } from '@src/lang/wasm'
import type { isDesktop } from '@src/lib/isDesktop'
import type { browserSaveFile } from '@src/lib/browserSaveFile'
import type { EngineCommandManager } from '@src/lang/std/engineConnection'
import type { KclManager } from '@src/lang/KclSingleton'
import {
  findOperationPlaneArtifact,
  type StdLibCallOp,
} from '@src/lang/queryAst'

// Exports a sketch feature to DXF format
export async function exportSketchToDxf(
  operation: StdLibCallOp,
  dependencies: {
    engineCommandManager: EngineCommandManager
    kclManager: KclManager
    toast: typeof toast
    uuidv4: typeof uuidv4
    base64Decode: typeof base64Decode
    isDesktop: typeof isDesktop
    browserSaveFile: typeof browserSaveFile
    writeFile?: (path: string, data: Uint8Array) => Promise<void>
    showSaveDialog?: (
      options: any
    ) => Promise<{ canceled: boolean; filePath: string }>
  }
): Promise<{ success: boolean; error?: string }> {
  const {
    engineCommandManager,
    kclManager,
    toast,
    uuidv4,
    base64Decode,
    isDesktop,
    browserSaveFile,
    writeFile,
    showSaveDialog,
  } = dependencies

  try {
    // Get the plane artifact associated with this sketch operation
    const planeArtifact = findOperationPlaneArtifact(
      operation,
      kclManager.artifactGraph
    )

    if (!planeArtifact || planeArtifact.type !== 'plane') {
      console.error('Could not find plane artifact for DXF export')
      toast.error('Could not find sketch for DXF export')
      return { success: false, error: 'Could not find plane artifact' }
    }

    // Check if the plane has sketch paths
    if (!('pathIds' in planeArtifact) || !planeArtifact.pathIds?.length) {
      console.error('Could not find path IDs for DXF export')
      toast.error('Could not find sketch entities for DXF export')
      return { success: false, error: 'Could not find path IDs' }
    }

    // Get all entity IDs from the plane's paths
    const entityIds: string[] = []
    for (const pathId of planeArtifact.pathIds) {
      const pathArtifact = kclManager.artifactGraph.get(pathId)
      if (pathArtifact) {
        if (
          'compositeSolidId' in pathArtifact &&
          pathArtifact.compositeSolidId
        ) {
          // Sketch has been extruded - use the composite solid ID
          entityIds.push(pathArtifact.compositeSolidId)
        } else {
          // Sketch hasn't been extruded - use the path ID
          entityIds.push(pathId)
        }
      }
    }

    if (entityIds.length === 0) {
      console.error('Could not find any sketch entities for DXF export')
      toast.error('Could not find sketch entities for DXF export')
      return { success: false, error: 'Could not find sketch entities' }
    }

    const toastId = toast.loading('Exporting sketch to DXF...')

    // Use the export2d command for DXF export
    const response = await engineCommandManager.sendSceneCommand(
      {
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'export2d',
          entity_ids: entityIds,
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
      response.resp.data.modeling_response.type === 'export2d' &&
      'data' in response.resp.data.modeling_response &&
      'files' in response.resp.data.modeling_response.data
    ) {
      const fileName = 'sketch.dxf'
      const exportFiles = response.resp.data.modeling_response.data.files

      // Save file
      const exportFile = exportFiles[0]
      const decoded = base64Decode(exportFile.contents)

      if (decoded instanceof Error) {
        console.error('Base64 decode failed:', decoded)
        toast.error('Failed to decode DXF file data', { id: toastId })
        return { success: false, error: 'Base64 decode failed' }
      }

      // Save directly as binary data
      const uint8Array = new Uint8Array(decoded)

      if (isDesktop()) {
        // Desktop: use electron file dialog
        if (!writeFile) {
          toast.error('File operations not available', { id: toastId })
          return { success: false, error: 'File operations not available' }
        }

        if (window.electron?.process.env.NODE_ENV === 'test') {
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
          await writeFile(
            window.electron.join(downloadDir, fileName),
            uint8Array
          )
          toast.success('DXF export completed [TEST]', { id: toastId })
          return { success: true }
        }

        if (!showSaveDialog) {
          toast.error('Save dialog not available', { id: toastId })
          return { success: false, error: 'Save dialog not available' }
        }

        const filePathMeta = await showSaveDialog({
          defaultPath: fileName,
          filters: [
            {
              name: 'DXF files',
              extensions: ['dxf'],
            },
          ],
        })

        if (!filePathMeta.canceled) {
          await writeFile(filePathMeta.filePath, uint8Array)
          toast.success('DXF export completed', { id: toastId })
          return { success: true }
        } else {
          toast.dismiss(toastId)
          return { success: false, error: 'User canceled save' }
        }
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
  } catch (error) {
    console.error('DXF export error:', error)
    toast.error('Failed to export sketch to DXF')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
