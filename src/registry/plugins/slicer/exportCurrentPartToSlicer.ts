import type { OutputFormat3d } from '@rust/kcl-lib/bindings/ModelingCmd'
import { EXPORT_TOAST_MESSAGES } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import type { PluginIpcChannel } from '@src/registry/pluginIpc'
import type { SlicerLaunchResult } from '@src/registry/plugins/slicer/types'
import toast from 'react-hot-toast'

export type ExportCurrentPartToSlicerOptions = {
  slicerName: string
  ipcChannel: PluginIpcChannel
  exportDirectoryName: string
  outputFileExtension: 'stl'
  outputFormat?: OutputFormat3d
  successMessage?: string
}

const DEFAULT_STL_FORMAT: OutputFormat3d = {
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

function getExportFileName(
  currentFileName: string | null,
  outputFileExtension: ExportCurrentPartToSlicerOptions['outputFileExtension']
) {
  const extension = `.${outputFileExtension}`
  const fileName = (currentFileName ?? `output${extension}`).replace(
    /\.kcl$/i,
    extension
  )
  return fileName.includes('.') ? fileName : `${fileName}${extension}`
}

export async function exportCurrentPartToSlicer({
  slicerName,
  ipcChannel,
  exportDirectoryName,
  outputFileExtension,
  outputFormat = DEFAULT_STL_FORMAT,
  successMessage = `Opened exported file in ${slicerName}.`,
}: ExportCurrentPartToSlicerOptions) {
  const electron = window.electron
  const kclManager = window.app?.singletons.kclManager

  if (!electron) {
    toast.error(`Export to ${slicerName} is only available in the desktop app.`)
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

  const toastId = toast.loading(
    `Exporting ${outputFileExtension.toUpperCase()} for ${slicerName}...`
  )
  try {
    const files = await kclManager.rustContext.export(
      outputFormat,
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
      exportDirectoryName
    )
    const exportPath = electron.path.join(
      exportDir,
      getExportFileName(kclManager.currentFileName, outputFileExtension)
    )

    await fsZds.mkdir(exportDir, { recursive: true })
    await fsZds.writeFile(exportPath, new Uint8Array(file.contents))

    const result = await electron.pluginIpc.invoke<SlicerLaunchResult>(
      ipcChannel,
      exportPath
    )
    if (!result.ok) {
      toast.error(result.error, { id: toastId, duration: 10_000 })
      return
    }

    toast.success(successMessage, { id: toastId })
  } catch (error) {
    console.error(error)
    toast.error(EXPORT_TOAST_MESSAGES.FAILED, { id: toastId })
  }
}
