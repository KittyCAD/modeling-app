import { defineRegistryItem, provide } from '@kittycad/registry'
import { useSignals } from '@preact/signals-react/runtime'
import { useAppState } from '@src/AppState'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import { isDesktop } from '@src/lib/isDesktop'
import { DefaultLayoutToolbarID } from '@src/lib/layout/configs/default'
import { reportRejection } from '@src/lib/trap'
import { EngineConnectionStateType } from '@src/network/utils'
import {
  layoutActionLibraryValueSpec,
  layoutContributionsValueSpec,
} from '@src/registry/contracts/layout'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { exportCurrentPartToPrusaSlicer } from '@src/registry/plugins/prusaSlicer/exportToPrusaSlicer'

const exportToPrusaSlicerActionType = 'exportToPrusaSlicer'

function useExportToPrusaSlicerDisabled() {
  useSignals()
  const { overallState, immediateState } = useNetworkContext()
  const { isStreamReady } = useAppState()
  const kclManager = window.app?.singletons.kclManager
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
    provide(layoutActionLibraryValueSpec, {
      [exportToPrusaSlicerActionType]: {
        useHidden: () => !isDesktop(),
        useDisabled: useExportToPrusaSlicerDisabled,
        execute: () => {
          exportCurrentPartToPrusaSlicer().catch(reportRejection)
        },
      },
    }),
    provide(layoutContributionsValueSpec, {
      id: 'prusa-slicer.left-toolbar.action',
      kind: 'action',
      action: {
        id: 'export-to-prusaslicer',
        label: 'Export to PrusaSlicer',
        icon: 'printer3d',
        actionType: exportToPrusaSlicerActionType,
      },
      placement: {
        targetPaneId: DefaultLayoutToolbarID.Left,
        position: 'end',
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
  defaultSetting: 'off',
})

export const order = 30
export default prusaSlicer
