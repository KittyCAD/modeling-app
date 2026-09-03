import type { ModelingCommandArgOverrides } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { RevolveCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import {
  activeInModelingDialog,
  bodyTypeResultArg,
  compactSelectionDialog,
  isEditingNode,
  isEditingNodeSelection,
  isUsingModelingDialog,
  modelingDialogLayout,
  profileSelectionRequiresBodyType,
} from '@src/lib/commandBarConfigs/modelingDialogShared'
import {
  getRevolveAxisMode,
  getRevolveDirectionMode,
  getRevolveExtentType,
  normalizeRevolveDialogArguments,
} from '@src/lib/commandBarConfigs/revolveDialog'
import { KCL_DEFAULT_DEGREE } from '@src/lib/constants'

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
    defaultValue: ({
      argumentsToSubmit,
    }: {
      argumentsToSubmit: Record<string, unknown>
    }) => getRevolveAxisMode(argumentsToSubmit),
    options: [
      { name: 'Sketch axis', value: 'Axis' },
      { name: 'Selected edge', value: 'Edge' },
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
    required: (context) =>
      getRevolveAxisMode(context.argumentsToSubmit) === 'Axis',
    inputType: 'options',
    displayName: 'Sketch Axis',
    defaultValue: 'X',
    hidden: (context) =>
      isUsingModelingDialog(context) &&
      getRevolveAxisMode(context.argumentsToSubmit) !== 'Axis',
    options: [
      { name: 'X axis', value: 'X' },
      { name: 'Y axis', value: 'Y' },
    ],
    dialog: {
      displayName: 'Sketch axis',
      group: 'axis',
      order: 0,
      controlStyle: 'segmented',
    },
  },
  edge: {
    required: (context) =>
      getRevolveAxisMode(context.argumentsToSubmit) === 'Edge',
    inputType: 'selection',
    selectionTypes: ['segment', 'sweepEdge', 'edgeCutEdge'],
    multiple: false,
    hidden: (context) =>
      isEditingNode(context) ||
      getRevolveAxisMode(context.argumentsToSubmit) !== 'Edge',
    dialog: {
      displayName: 'Axis edge',
      ...compactSelectionDialog('axis', 'Select an axis edge', {
        order: 0,
      }),
    },
  },
  extentType: {
    inputType: 'options',
    required: isUsingModelingDialog,
    skip: true,
    defaultValue: ({
      argumentsToSubmit,
    }: {
      argumentsToSubmit: Record<string, unknown>
    }) => getRevolveExtentType(argumentsToSubmit),
    hidden: (context) => !isUsingModelingDialog(context),
    options: [
      { name: 'Full', value: 'full' },
      { name: 'Angle', value: 'angle' },
    ],
    dialog: {
      displayName: 'Type',
      group: 'extent',
      order: -20,
      controlStyle: 'segmented',
    },
  },
  directionMode: {
    inputType: 'options',
    required: (context) =>
      isUsingModelingDialog(context) &&
      getRevolveExtentType(context.argumentsToSubmit) === 'angle',
    skip: true,
    defaultValue: ({
      argumentsToSubmit,
    }: {
      argumentsToSubmit: Record<string, unknown>
    }) => getRevolveDirectionMode(argumentsToSubmit),
    hidden: (context) =>
      !isUsingModelingDialog(context) ||
      getRevolveExtentType(context.argumentsToSubmit) === 'full',
    options: [
      { name: 'One side', value: 'oneSide' },
      { name: 'Symmetric', value: 'symmetric' },
      { name: 'Two sides', value: 'twoSides' },
    ],
    dialog: {
      displayName: 'Direction',
      group: 'extent',
      order: -10,
      controlStyle: 'segmented',
    },
  },
  angle: {
    ...activeInModelingDialog(
      (argumentsToSubmit) =>
        getRevolveExtentType(argumentsToSubmit) === 'angle',
      { requiredOutsideDialog: true }
    ),
    defaultValue: KCL_DEFAULT_DEGREE,
    dialog: {
      group: 'extent',
      order: 0,
      prepopulate: true,
    },
  },
  symmetric: {
    hidden: (context) => isUsingModelingDialog(context),
    dialog: {
      group: 'extent',
    },
  },
  bidirectionalAngle: {
    ...activeInModelingDialog(
      (argumentsToSubmit) =>
        getRevolveExtentType(argumentsToSubmit) === 'angle' &&
        getRevolveDirectionMode(argumentsToSubmit) === 'twoSides'
    ),
    dialog: {
      displayName: 'Second angle',
      group: 'extent',
      order: 10,
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
