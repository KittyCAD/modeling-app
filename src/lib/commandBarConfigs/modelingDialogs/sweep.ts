import type { ModelingCommandArgOverrides } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { SweepCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import {
  bodyTypeResultArg,
  compactSelectionDialog,
  isEditingNode,
  isEditingNodeSelection,
  isUsingModelingDialog,
  modelingDialogLayout,
  profileSelectionRequiresBodyType,
  type ModelingDialogContext,
} from '@src/lib/commandBarConfigs/modelingDialogShared'

function hasLegacySweepAlignment({ argumentsToSubmit }: ModelingDialogContext) {
  return (
    argumentsToSubmit.relativeTo === 'SKETCH_PLANE' ||
    argumentsToSubmit.relativeTo === 'TRAJECTORY'
  )
}

export const sweepDialogLayout = modelingDialogLayout([
  {
    id: 'profile',
    title: 'Profile',
  },
  {
    id: 'path',
    title: 'Path',
  },
  {
    id: 'alignment',
    title: 'Alignment',
    description: 'Position and orient the profile at the start of the path.',
  },
  {
    id: 'result',
    title: 'Result',
  },
])

export const sweepDialogOverrides = {
  sketches: {
    inputType: 'selection',
    displayName: 'Profiles',
    dialog: compactSelectionDialog('profile', 'Select profiles'),
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
    dialog: {
      displayName: 'Path',
      ...compactSelectionDialog('path', 'Select a path'),
    },
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
    dialog: {
      displayName: 'Legacy alignment',
      group: 'alignment',
      order: -20,
      controlStyle: 'segmented',
    },
  },
  translateProfileToPath: {
    hidden: (context) =>
      isUsingModelingDialog(context) && hasLegacySweepAlignment(context),
    dialog: {
      displayName: 'Move profile to path',
      group: 'alignment',
      order: 0,
      controlStyle: 'segmented',
    },
  },
  orientProfilePerpendicular: {
    hidden: (context) =>
      isUsingModelingDialog(context) && hasLegacySweepAlignment(context),
    dialog: {
      displayName: 'Orient profile perpendicular',
      group: 'alignment',
      order: 10,
      controlStyle: 'segmented',
    },
  },
  sectional: {
    description: 'Split the sweep at each path segment.',
    dialog: {
      displayName: 'Section by path segments',
      group: 'advanced',
      order: 0,
      controlStyle: 'segmented',
    },
  },
  tolerance: {
    description:
      'Leave unchanged unless the sweep needs a custom geometric tolerance.',
    dialog: {
      displayName: 'Tolerance',
      group: 'advanced',
      order: 10,
    },
  },
  tagStart: {
    dialog: {
      displayName: 'Start face tag',
      group: 'advanced',
      order: 20,
    },
  },
  tagEnd: {
    dialog: {
      displayName: 'End face tag',
      group: 'advanced',
      order: 30,
    },
  },
  bodyType: bodyTypeResultArg(profileSelectionRequiresBodyType),
  version: {
    defaultValue: '2',
    dialog: {
      displayName: 'Algorithm version',
      group: 'advanced',
      order: 40,
    },
  },
} satisfies ModelingCommandArgOverrides<SweepCommandArgs>
