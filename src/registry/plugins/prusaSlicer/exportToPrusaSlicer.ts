import { PRUSA_SLICER_OPEN_STL_CHANNEL } from '@src/registry/plugins/prusaSlicer/ipc'
import { exportCurrentPartToSlicer } from '@src/registry/plugins/slicer/exportCurrentPartToSlicer'

export async function exportCurrentPartToPrusaSlicer() {
  return exportCurrentPartToSlicer({
    slicerName: 'PrusaSlicer',
    ipcChannel: PRUSA_SLICER_OPEN_STL_CHANNEL,
    exportDirectoryName: 'prusa-slicer-exports',
    outputFileExtension: 'stl',
    successMessage: 'Opened STL in PrusaSlicer.',
  })
}
