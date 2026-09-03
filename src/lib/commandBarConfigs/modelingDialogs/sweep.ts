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
} from '@src/lib/commandBarConfigs/modelingDialogShared'
import {
  getSweepProfileOrientation,
  getSweepProfilePosition,
  hasLegacySweepAlignment,
  normalizeSweepDialogArguments,
} from '@src/lib/commandBarConfigs/sweepDialog'

export const sweepDialogLayout = modelingDialogLayout(
  [
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
  ],
  normalizeSweepDialogArguments
)

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
        ? !hasLegacySweepAlignment(context.argumentsToSubmit)
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
  profilePosition: {
    inputType: 'options',
    required: (context) =>
      isUsingModelingDialog(context) &&
      !hasLegacySweepAlignment(context.argumentsToSubmit) &&
      (!isEditingNode(context) ||
        typeof context.argumentsToSubmit.translateProfileToPath === 'boolean'),
    skip: true,
    defaultValue: ({
      argumentsToSubmit,
    }: {
      argumentsToSubmit: Record<string, unknown>
    }) => getSweepProfilePosition(argumentsToSubmit),
    hidden: (context) =>
      !isUsingModelingDialog(context) ||
      hasLegacySweepAlignment(context.argumentsToSubmit),
    options: [
      { name: 'Original', value: 'original' },
      { name: 'Move to path', value: 'path' },
    ],
    dialog: {
      displayName: 'Position',
      group: 'alignment',
      order: -10,
      controlStyle: 'segmented',
    },
  },
  profileOrientation: {
    inputType: 'options',
    required: (context) =>
      isUsingModelingDialog(context) &&
      !hasLegacySweepAlignment(context.argumentsToSubmit) &&
      (!isEditingNode(context) ||
        typeof context.argumentsToSubmit.orientProfilePerpendicular ===
          'boolean'),
    skip: true,
    defaultValue: ({
      argumentsToSubmit,
    }: {
      argumentsToSubmit: Record<string, unknown>
    }) => getSweepProfileOrientation(argumentsToSubmit),
    hidden: (context) =>
      !isUsingModelingDialog(context) ||
      hasLegacySweepAlignment(context.argumentsToSubmit),
    options: [
      { name: 'Original', value: 'original' },
      { name: 'Perpendicular', value: 'perpendicular' },
    ],
    dialog: {
      displayName: 'Orientation',
      group: 'alignment',
      order: 0,
      controlStyle: 'segmented',
    },
  },
  translateProfileToPath: {
    hidden: (context) => isUsingModelingDialog(context),
    dialog: {
      group: 'alignment',
    },
  },
  orientProfilePerpendicular: {
    hidden: (context) => isUsingModelingDialog(context),
    dialog: {
      group: 'alignment',
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
