import type { CommandDialogLayout } from '@src/lib/commandTypes'
import type { ModelingCommandArgOverrides } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { SweepCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import {
  bodyTypeArg,
  isEditingNode,
  isEditingNodeSelection,
  isUsingModelingDialog,
  profileSelectionRequiresBodyType,
  type ModelingCommandContext,
} from '@src/lib/commandBarConfigs/modelingCommandUtils'

function hasLegacySweepAlignment({
  argumentsToSubmit,
}: ModelingCommandContext) {
  return (
    argumentsToSubmit.relativeTo === 'SKETCH_PLANE' ||
    argumentsToSubmit.relativeTo === 'TRAJECTORY'
  )
}

export const sweepLayout = [
  { title: 'Profile', args: ['sketches'] },
  { title: 'Path', args: ['path'] },
  {
    title: 'Alignment',
    args: [
      'relativeTo',
      'translateProfileToPath',
      'orientProfilePerpendicular',
    ],
    description: 'Position and orient the profile at the start of the path.',
  },
  { title: 'Result', args: ['bodyType'] },
  {
    title: 'More options',
    args: ['sectional', 'tolerance', 'tagStart', 'tagEnd', 'version'],
    collapsible: true,
  },
] satisfies CommandDialogLayout<keyof SweepCommandArgs>

export const sweepArgs = {
  sketches: {
    inputType: 'selection',
    displayName: 'Profiles',
    selectionTypes: [
      'solid2d',
      'segment',
      'cap',
      'wall',
      'pathRegion',
      'engineRegion',
    ],
    multiple: true,
    hidden: isEditingNodeSelection,
  },
  path: {
    inputType: 'selection',
    dialog: { selectionEmptyLabel: 'Select a path' },
    selectionTypes: ['segment', 'path', 'helix'],
    clearSelectionFirst: true,
    multiple: true,
    hidden: isEditingNodeSelection,
  },
  relativeTo: {
    inputType: 'options',
    hidden: (context) =>
      isUsingModelingDialog(context)
        ? !hasLegacySweepAlignment(context)
        : !isEditingNode(context) ||
          context.argumentsToSubmit.relativeTo === undefined,
    options: [
      { name: 'Sketch plane', value: 'SKETCH_PLANE' },
      { name: 'Trajectory curve', value: 'TRAJECTORY' },
    ],
    dialog: { displayName: 'Legacy alignment', controlStyle: 'segmented' },
  },
  translateProfileToPath: {
    hidden: (context) =>
      isUsingModelingDialog(context) && hasLegacySweepAlignment(context),
    dialog: { displayName: 'Move profile to path' },
  },
  orientProfilePerpendicular: {
    hidden: (context) =>
      isUsingModelingDialog(context) && hasLegacySweepAlignment(context),
    dialog: { displayName: 'Orient profile perpendicular' },
  },
  sectional: {
    description: 'Split the sweep at each path segment.',
    dialog: { displayName: 'Section by path segments' },
  },
  tolerance: {
    description:
      'Leave unchanged unless the sweep needs a custom geometric tolerance.',
  },
  tagStart: {
    dialog: { displayName: 'Start face tag' },
  },
  tagEnd: {
    dialog: { displayName: 'End face tag' },
  },
  bodyType: bodyTypeArg(profileSelectionRequiresBodyType),
  version: {
    defaultValue: '2',
    dialog: { displayName: 'Algorithm version' },
  },
} satisfies ModelingCommandArgOverrides<SweepCommandArgs>
