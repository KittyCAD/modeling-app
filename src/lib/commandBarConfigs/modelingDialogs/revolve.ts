import type { ModelingCommandArgOverrides } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { RevolveCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import {
  bodyTypeResultArg,
  compactSelectionDialog,
  isEditingNode,
  isEditingNodeSelection,
  isUsingModelingDialog,
  type ModelingDialogContext,
  modelingDialogLayout,
  profileSelectionRequiresBodyType,
} from '@src/lib/commandBarConfigs/modelingDialogShared'
import {
  getRevolveAxisMode,
  normalizeRevolveDialogArguments,
} from '@src/lib/commandBarConfigs/revolveDialog'
import { KCL_DEFAULT_DEGREE } from '@src/lib/constants'

function selectedAxisMode(context: ModelingDialogContext) {
  return isUsingModelingDialog(context)
    ? getRevolveAxisMode(context.argumentsToSubmit)
    : context.argumentsToSubmit.axisOrEdge
}

export const revolveDialogLayout = modelingDialogLayout(
  [
    {
      id: 'selection',
      title: 'Profile',
    },
    {
      id: 'axis',
      title: 'Axis',
    },
    {
      id: 'extent',
      title: 'Extent',
    },
    {
      id: 'result',
      title: 'Result',
    },
  ],
  normalizeRevolveDialogArguments
)

export const revolveDialogOverrides = {
  sketches: {
    inputType: 'selection',
    displayName: 'Profiles',
    dialog: compactSelectionDialog('selection', 'Select profiles'),
    selectionTypes: ['solid2d', 'segment', 'pathRegion', 'engineRegion'],
    multiple: true,
    hidden: isEditingNodeSelection,
  },
  axisOrEdge: {
    inputType: 'options',
    required: true,
    defaultValue: (context: ModelingDialogContext) =>
      isUsingModelingDialog(context)
        ? getRevolveAxisMode(context.argumentsToSubmit)
        : 'Axis',
    options: (context) =>
      isUsingModelingDialog(context)
        ? [
            { name: 'Sketch axis', value: 'Axis' },
            { name: 'Selected edge', value: 'Edge' },
          ]
        : [
            { name: 'Sketch Axis', isCurrent: true, value: 'Axis' },
            { name: 'Edge', isCurrent: false, value: 'Edge' },
          ],
    hidden: isEditingNode,
    dialog: {
      displayName: 'Reference',
      group: 'axis',
      order: -10,
      controlStyle: 'segmented',
    },
  },
  axis: {
    required: (context) => selectedAxisMode(context) === 'Axis',
    inputType: 'options',
    displayName: 'Sketch Axis',
    defaultValue: (context: ModelingDialogContext) =>
      isUsingModelingDialog(context) ? 'X' : undefined,
    hidden: (context) =>
      isUsingModelingDialog(context) &&
      getRevolveAxisMode(context.argumentsToSubmit) !== 'Axis',
    options: (context) =>
      isUsingModelingDialog(context)
        ? [
            { name: 'X axis', value: 'X' },
            { name: 'Y axis', value: 'Y' },
          ]
        : [
            { name: 'X Axis', isCurrent: true, value: 'X' },
            { name: 'Y Axis', isCurrent: false, value: 'Y' },
          ],
    dialog: {
      displayName: 'Sketch axis',
      group: 'axis',
      order: 0,
      controlStyle: 'segmented',
    },
  },
  edge: {
    required: (context) => selectedAxisMode(context) === 'Edge',
    inputType: 'selection',
    selectionTypes: ['segment', 'sweepEdge', 'edgeCutEdge'],
    multiple: false,
    hidden: (context) =>
      isEditingNode(context) || selectedAxisMode(context) !== 'Edge',
    dialog: {
      displayName: 'Axis edge',
      ...compactSelectionDialog('axis', 'Select an axis edge', {
        order: 0,
      }),
    },
  },
  angle: {
    required: (context) => !isUsingModelingDialog(context),
    defaultValue: (context: ModelingDialogContext) =>
      isUsingModelingDialog(context) ? '' : KCL_DEFAULT_DEGREE,
    dialog: {
      displayName: 'Angle',
      group: 'extent',
      order: 0,
    },
  },
  symmetric: {
    dialog: {
      displayName: 'Symmetric',
      group: 'extent',
      order: 10,
      controlStyle: 'segmented',
    },
  },
  bidirectionalAngle: {
    dialog: {
      displayName: 'Second angle',
      group: 'extent',
      order: 20,
    },
  },
  tolerance: {
    dialog: {
      group: 'advanced',
      order: 0,
    },
  },
  tagStart: {
    dialog: {
      displayName: 'Start face tag',
      group: 'advanced',
      order: 10,
    },
  },
  tagEnd: {
    dialog: {
      displayName: 'End face tag',
      group: 'advanced',
      order: 20,
    },
  },
  bodyType: bodyTypeResultArg(profileSelectionRequiresBodyType),
} satisfies ModelingCommandArgOverrides<RevolveCommandArgs>
