import type { OutputFormat3d } from '@rust/kcl-lib/bindings/ModelingCmd'
import { EXPORT_TOAST_MESSAGES } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import {
  type OpenStlInPrusaSlicerResult,
  PRUSA_SLICER_OPEN_STL_CHANNEL,
} from '@src/registry/plugins/prusaSlicer/ipc'
import toast from 'react-hot-toast'

const EXPORT_DIR_NAME = 'prusa-slicer-exports'

function getExportFileName(currentFileName: string | null) {
  const fileName = (currentFileName ?? 'output.kcl').replace(/\.kcl$/i, '.stl')
  return fileName.includes('.') ? fileName : `${fileName}.stl`
}

export async function exportCurrentPartToPrusaSlicer() {
  const electron = window.electron
  const kclManager = window.app?.singletons.kclManager

  if (!electron) {
    toast.error('Export to PrusaSlicer is only available in the desktop app.')
    return
  }

  if (!kclManager) {
    toast.error('The app is not ready to export yet.')
    return
  }

  if (kclManager.hasErrors() || kclManager.ast.body.length === 0) {
    toast.error(
      kclManager.hasErrors()
        ? 'Unable to export due to KCL errors.'
        : 'Unable to export an empty scene.'
    )
    return
  }

  const toastId = toast.loading('Exporting STL for PrusaSlicer...')
  try {
    const format: OutputFormat3d = {
      type: 'stl',
      coords: {
        forward: {
          axis: 'y',
          direction: 'negative',
        },
        up: {
          axis: 'z',
          direction: 'positive',
        },
      },
      storage: 'ascii',
      units: 'mm',
      selection: { type: 'default_scene' },
    }

    const files = await kclManager.rustContext.export(
      format,
      {
        settings: { modeling: { base_unit: 'mm' } },
      },
      toastId
    )

    if (files === undefined) {
      return
    }

    const file = files[0]
    if (!file) {
      toast.error(EXPORT_TOAST_MESSAGES.FAILED, { id: toastId })
      return
    }

    const exportDir = electron.path.join(
      await electron.getPath('userData'),
      EXPORT_DIR_NAME
    )
    const exportPath = electron.path.join(
      exportDir,
      getExportFileName(kclManager.currentFileName)
    )

    await fsZds.mkdir(exportDir, { recursive: true })
    await fsZds.writeFile(exportPath, new Uint8Array(file.contents))

    const result = await electron.pluginIpc.invoke<OpenStlInPrusaSlicerResult>(
      PRUSA_SLICER_OPEN_STL_CHANNEL,
      exportPath
    )
    if (!result.ok) {
      toast.error(result.error, { id: toastId, duration: 10_000 })
      return
    }

    toast.success('Opened STL in PrusaSlicer.', { id: toastId })
  } catch (error) {
    console.error(error)
    toast.error(EXPORT_TOAST_MESSAGES.FAILED, { id: toastId })
  }
}
