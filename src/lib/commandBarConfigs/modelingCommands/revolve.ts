import type { CommandDialogLayout } from '@src/lib/commandTypes'
import type { ModelingCommandArgOverrides } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { RevolveCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import {
  bodyTypeArg,
  isEditingNode,
  isEditingNodeSelection,
  isUsingModelingDialog,
  type ModelingCommandContext,
  profileSelectionRequiresBodyType,
} from '@src/lib/commandBarConfigs/modelingCommandUtils'
import { getRevolveAxisMode } from '@src/lib/commandBarConfigs/revolveArguments'
import { KCL_DEFAULT_DEGREE } from '@src/lib/constants'

function selectedAxisMode(context: ModelingCommandContext) {
  return isUsingModelingDialog(context)
    ? getRevolveAxisMode(context.argumentsToSubmit)
    : context.argumentsToSubmit.axisOrEdge
}

export const revolveLayout = [
  { title: 'Profile', args: ['sketches'] },
  { title: 'Axis', args: ['axisOrEdge', 'axis', 'edge'] },
  { title: 'Extent', args: ['angle', 'symmetric', 'bidirectionalAngle'] },
  { title: 'Result', args: ['bodyType'] },
  {
    title: 'More options',
    args: ['tolerance', 'tagStart', 'tagEnd'],
    collapsible: true,
  },
] satisfies CommandDialogLayout<keyof RevolveCommandArgs>

export const revolveArgs = {
  sketches: {
    inputType: 'selection',
    displayName: 'Profiles',
    selectionTypes: ['solid2d', 'segment', 'pathRegion', 'engineRegion'],
    multiple: true,
    hidden: isEditingNodeSelection,
  },
  axisOrEdge: {
    inputType: 'options',
    required: true,
    defaultValue: (context: ModelingCommandContext) =>
      isUsingModelingDialog(context)
        ? getRevolveAxisMode(context.argumentsToSubmit)
        : 'Axis',
    options: [
      { name: 'Sketch Axis', isCurrent: true, value: 'Axis' },
      { name: 'Edge', isCurrent: false, value: 'Edge' },
    ],
    hidden: isEditingNode,
    dialog: { displayName: 'Reference', controlStyle: 'segmented' },
  },
  axis: {
    required: (context) => selectedAxisMode(context) === 'Axis',
    inputType: 'options',
    displayName: 'Sketch Axis',
    defaultValue: (context: ModelingCommandContext) =>
      isUsingModelingDialog(context) ? 'X' : undefined,
    hidden: (context) =>
      isUsingModelingDialog(context) &&
      getRevolveAxisMode(context.argumentsToSubmit) !== 'Axis',
    options: [
      { name: 'X Axis', isCurrent: true, value: 'X' },
      { name: 'Y Axis', isCurrent: false, value: 'Y' },
    ],
    dialog: { displayName: 'Sketch axis', controlStyle: 'segmented' },
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
      selectionEmptyLabel: 'Select an axis edge',
    },
  },
  angle: {
    required: (context) => !isUsingModelingDialog(context),
    defaultValue: KCL_DEFAULT_DEGREE,
  },
  bidirectionalAngle: {
    dialog: { displayName: 'Second angle' },
  },
  tagStart: {
    dialog: { displayName: 'Start face tag' },
  },
  tagEnd: {
    dialog: { displayName: 'End face tag' },
  },
  bodyType: bodyTypeArg(profileSelectionRequiresBodyType),
} satisfies ModelingCommandArgOverrides<RevolveCommandArgs>
