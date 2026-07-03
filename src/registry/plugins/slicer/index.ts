import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { useSignals } from '@preact/signals-react/runtime'
import { useAppState } from '@src/AppState'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import type { Command } from '@src/lib/commandTypes'
import { isDesktop } from '@src/lib/isDesktop'
import { DefaultLayoutToolbarID } from '@src/lib/layout/configs/default'
import { EngineConnectionStateType } from '@src/network/utils'
import {
  commandSystemService,
  provideCommand,
} from '@src/registry/contracts/commands'
import {
  layoutActionLibraryValueSpec,
  layoutContributionsValueSpec,
} from '@src/registry/contracts/layout'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import {
  EXPORT_TO_SLICER_ACTION_TYPE,
  EXPORT_TO_SLICER_COMMAND_GROUP_ID,
  EXPORT_TO_SLICER_COMMAND_ID,
  EXPORT_TO_SLICER_COMMAND_NAME,
  SLICER_PLUGIN_ID,
} from '@src/registry/plugins/slicer/constants'
import { exportCurrentPartToSlicer } from '@src/registry/plugins/slicer/exportCurrentPartToSlicer'
import {
  SLICER_COMMAND_OPTIONS,
  type SlicerId,
  getSlicerExportDefinition,
} from '@src/registry/plugins/slicer/slicerDefinitions'

type ExportToSlicerCommandArgs = {
  slicer: SlicerId
}

function useExportToSlicerDisabled() {
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

function getSubmittedSlicerId(data: unknown): SlicerId | undefined {
  if (!data || typeof data !== 'object' || !('slicer' in data)) {
    return undefined
  }

  const slicer = (data as Partial<ExportToSlicerCommandArgs>).slicer
  return getSlicerExportDefinition(slicer) ? slicer : undefined
}

export const exportToSlicerCommand: Command = {
  id: EXPORT_TO_SLICER_COMMAND_ID,
  name: EXPORT_TO_SLICER_COMMAND_NAME,
  displayName: EXPORT_TO_SLICER_COMMAND_NAME,
  description: 'Export the current part as STL and open it in a slicer.',
  icon: 'printer3d',
  groupId: EXPORT_TO_SLICER_COMMAND_GROUP_ID,
  hide: 'web',
  needsReview: false,
  args: {
    slicer: {
      displayName: 'Slicer',
      inputType: 'options',
      required: true,
      options: SLICER_COMMAND_OPTIONS,
      valueSummary: (value) =>
        getSlicerExportDefinition(value)?.slicerName ?? String(value),
    },
  },
  onSubmit: (data) => {
    const definition = getSlicerExportDefinition(getSubmittedSlicerId(data))
    if (!definition) {
      return new Error('Select a slicer to export to.')
    }

    return exportCurrentPartToSlicer(definition)
  },
}

const exportToSlicerSidebarItem = defineRegistryItemFactory((ctx) => {
  return {
    item: defineRuntimeRegistryItem({
      id: 'slicer.left-toolbar.item',
      provides: [
        provideCommand(exportToSlicerCommand),
        provide(layoutActionLibraryValueSpec, {
          [EXPORT_TO_SLICER_ACTION_TYPE]: {
            useHidden: () => !isDesktop(),
            useDisabled: useExportToSlicerDisabled,
            execute: () => {
              const commandSystem = ctx.services.get(commandSystemService)
              commandSystem.send({
                type: 'Find and select command',
                data: {
                  name: EXPORT_TO_SLICER_COMMAND_NAME,
                  groupId: EXPORT_TO_SLICER_COMMAND_GROUP_ID,
                },
              })
            },
          },
        }),
        provide(layoutContributionsValueSpec, {
          id: 'slicer.left-toolbar.action',
          kind: 'action',
          action: {
            id: 'export-to-slicer',
            label: EXPORT_TO_SLICER_COMMAND_NAME,
            icon: 'printer3d',
            actionType: EXPORT_TO_SLICER_ACTION_TYPE,
          },
          placement: {
            targetPaneId: DefaultLayoutToolbarID.Left,
            position: 'end',
          },
        }),
      ],
    }),
  }
}, 'slicer.left-toolbar.item')

const slicer = createZdsPlugin({
  id: SLICER_PLUGIN_ID,
  title: 'Slicer export',
  description:
    'Adds an Export to Slicer command that exports the current part as STL and opens it in the selected slicer.',
  items: [exportToSlicerSidebarItem],
  defaultSetting: 'off',
})

export const order = 30
export default slicer
