import { defineRegistryItem, provide } from '@kittycad/registry'
import { useAppState } from '@src/AppState'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { isDesktop } from '@src/lib/isDesktop'
import { DefaultLayoutToolbarID } from '@src/lib/layout/configs/default'
import { EngineConnectionStateType } from '@src/network/utils'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import {
  layoutActionDefinitionsValueSpec,
  layoutPaneActionsValueSpec,
} from '@src/valueSpecs'
import { exportCurrentPartToPrusaSlicer } from '@src/registry/plugins/prusaSlicer/exportToPrusaSlicer'

const exportToPrusaSlicerActionType = 'exportToPrusaSlicer'

function useExportToPrusaSlicerDisabled() {
  const { overallState, immediateState } = useNetworkContext()
  const { isStreamReady } = useAppState()
  const kclManager = window.kclManager
  const engineIsBusyOrUnavailable =
    !kclManager ||
    (overallState !== NetworkHealthState.Ok &&
      overallState !== NetworkHealthState.Weak) ||
    kclManager.isExecutingSignal.value ||
    immediateState.type !== EngineConnectionStateType.ConnectionEstablished ||
    !isStreamReady

  return engineIsBusyOrUnavailable
    ? 'Need engine connection to export'
    : undefined
}

const exportToPrusaSlicerSidebarItem = defineRegistryItem({
  provides: [
    provide(layoutActionDefinitionsValueSpec, {
      [exportToPrusaSlicerActionType]: {
        useHidden: () => !isDesktop(),
        useDisabled: useExportToPrusaSlicerDisabled,
        execute: () => {
          exportCurrentPartToPrusaSlicer().catch(console.error)
        },
      },
    }),
    provide(layoutPaneActionsValueSpec, {
      paneId: DefaultLayoutToolbarID.Left,
      order: 30,
      action: {
        id: 'export-to-prusaslicer',
        label: 'Export to PrusaSlicer',
        icon: 'printer3d',
        actionType: exportToPrusaSlicerActionType,
      },
    }),
  ],
})

const prusaSlicer = createZdsPlugin({
  id: 'prusa-slicer',
  title: 'PrusaSlicer export',
  description:
    'Adds a left-sidebar action that exports the current part as STL and opens it in PrusaSlicer.',
  items: [exportToPrusaSlicerSidebarItem],
  defaultSetting: 'core',
})

export const order = 30
export default prusaSlicer
