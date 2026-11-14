import { useSignals } from '@preact/signals-react/runtime'
import { useAppState } from '@src/AppState'
import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { NetworkHealthState } from '@src/hooks/useNetworkStatus'
import type { KclManager } from '@src/lang/KclManager'
import type { Command } from '@src/lib/commandTypes'
import { selectCommand } from '@src/lib/commandUtils'
import { EngineConnectionStateType } from '@src/lib/engineConnection/utils'
import { isDesktop } from '@src/lib/isDesktop'
import { DefaultLayoutToolbarID } from '@src/lib/layout/configs/default'
import {
  layoutActionLibraryFacet,
  layoutContributionsFacet,
} from '@src/lib/layout/registry/contract'
import {
  observations as commandsObservations,
  MODE_MODELING_COMMAND_SCOPE,
  provideCommand,
} from '@src/registry/contracts/commands'
import {
  observations as fileOperationsObservations,
  type FileOperationsRegistryService,
} from '@src/registry/contracts/fileOperations'
import { observations as projectSessionObservations } from '@src/registry/contracts/projectSession'
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
  getSlicerExportDefinition,
  SLICER_COMMAND_OPTIONS,
  type SlicerId,
} from '@src/registry/plugins/slicer/slicerDefinitions'
import {
  extension as defineExtension,
  contribute,
  type InputOf,
  type Extension,
} from 'plankton'
type ExportToSlicerCommandArgs = {
  slicer: SlicerId
}
function createUseExportToSlicerDisabled({
  getKclManager,
}: {
  getKclManager: () => KclManager | undefined
}) {
  return function useExportToSlicerDisabled() {
    useSignals()
    const { overallState, immediateState } = useNetworkContext()
    const { isStreamReady } = useAppState()
    const kclManager = getKclManager()
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
}
function getSubmittedSlicerId(data: unknown): SlicerId | undefined {
  if (!data || typeof data !== 'object' || !('slicer' in data)) {
    return undefined
  }
  const slicer = (data as Partial<ExportToSlicerCommandArgs>).slicer
  return getSlicerExportDefinition(slicer) ? slicer : undefined
}
function createExportToSlicerCommand({
  getKclManager,
  getFileOperations,
}: {
  getKclManager: () => KclManager | undefined
  getFileOperations: () => FileOperationsRegistryService
}): Command {
  return {
    scopes: [MODE_MODELING_COMMAND_SCOPE],
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
      const kclManager = getKclManager()
      if (!kclManager) {
        return new Error('No active modeling context')
      }
      return exportCurrentPartToSlicer(definition, {
        kclManager,
        fileOperations: getFileOperations(),
      })
    },
  }
}
const exportToSlicerSidebarItem: Extension = defineExtension({
  dependencies: {
    commands: commandsObservations,
    projectSession: projectSessionObservations,
    fileOperations: fileOperationsObservations,
  },
  key: 'slicer.left-toolbar.item',
  create: ({
    commands: commandsInputs,
    projectSession: projectSessionInputs,
    fileOperations: fileOperationsInputs,
  }) => {
    const getCommandSystem = () =>
      commandsInputs.commandSystemService.required()
    const getKclManager = () =>
      projectSessionInputs.projectSession.current.value?.project.value
        ?.executingEditor.value ?? undefined
    const exportToSlicerCommand = createExportToSlicerCommand({
      getKclManager,
      getFileOperations: () =>
        fileOperationsInputs.fileOperationsService.required(),
    })
    const useExportToSlicerDisabled = createUseExportToSlicerDisabled({
      getKclManager,
    })
    const _layoutActionLibraryContribution: InputOf<
      typeof layoutActionLibraryFacet
    > = {
      [EXPORT_TO_SLICER_ACTION_TYPE]: {
        useHidden: () => !isDesktop(),
        useDisabled: useExportToSlicerDisabled,
        execute: () => {
          selectCommand(getCommandSystem(), {
            name: EXPORT_TO_SLICER_COMMAND_NAME,
            groupId: EXPORT_TO_SLICER_COMMAND_GROUP_ID,
          })
        },
      },
    } satisfies InputOf<typeof layoutActionLibraryFacet>
    const _layoutContributionsContribution: InputOf<
      typeof layoutContributionsFacet
    > = {
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
    } satisfies InputOf<typeof layoutContributionsFacet>
    return {
      items: [
        provideCommand(exportToSlicerCommand),
        contribute(
          layoutActionLibraryFacet,
          () => _layoutActionLibraryContribution
        ),
        contribute(
          layoutContributionsFacet,
          () => _layoutContributionsContribution
        ),
      ],
    }
  },
})
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
