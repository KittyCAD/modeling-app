import type { CommandArgumentOption } from '@src/lib/commandTypes'
import { CURA_SLICER_OPEN_STL_CHANNEL } from '@src/registry/plugins/curaSlicer/ipc'
import { PRUSA_SLICER_OPEN_STL_CHANNEL } from '@src/registry/plugins/prusaSlicer/ipc'
import type { ExportCurrentPartToSlicerOptions } from '@src/registry/plugins/slicer/exportCurrentPartToSlicer'

export type SlicerExportDefinition = ExportCurrentPartToSlicerOptions & {
  id: string
  isCurrent?: boolean
}

export const SLICER_EXPORT_DEFINITIONS = [
  {
    id: 'prusa-slicer',
    slicerName: 'PrusaSlicer',
    ipcChannel: PRUSA_SLICER_OPEN_STL_CHANNEL,
    exportDirectoryName: 'prusa-slicer-exports',
    outputFileExtension: 'stl',
    successMessage: 'Opened STL in PrusaSlicer.',
    isCurrent: true,
  },
  {
    id: 'cura',
    slicerName: 'Cura',
    ipcChannel: CURA_SLICER_OPEN_STL_CHANNEL,
    exportDirectoryName: 'cura-slicer-exports',
    outputFileExtension: 'stl',
    successMessage: 'Opened STL in Cura.',
  },
] as const satisfies readonly SlicerExportDefinition[]

export type SlicerId = (typeof SLICER_EXPORT_DEFINITIONS)[number]['id']

export function getSlicerExportDefinition(
  slicerId: unknown
): SlicerExportDefinition | undefined {
  return SLICER_EXPORT_DEFINITIONS.find(
    (definition) => definition.id === slicerId
  )
}

export const SLICER_COMMAND_OPTIONS: ReadonlyArray<
  CommandArgumentOption<SlicerId>
> = SLICER_EXPORT_DEFINITIONS.map((definition) => ({
  name: definition.slicerName,
  value: definition.id,
  isCurrent: 'isCurrent' in definition ? definition.isCurrent : undefined,
}))
