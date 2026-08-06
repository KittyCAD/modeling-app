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
    displayName: 'Path',
    dialog: compactSelectionDialog('path', 'Select a path'),
    selectionTypes: ['segment', 'path', 'helix'],
    clearSelectionFirst: true,
    multiple: true,
    hidden: isEditingNodeSelection,
  },
  relativeTo: {
    inputType: 'options',
    displayName: 'Legacy alignment',
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
      group: 'alignment',
      order: -20,
      controlStyle: 'segmented',
    },
  },
  profilePosition: {
    inputType: 'options',
    displayName: 'Position',
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
      group: 'alignment',
      order: -10,
      controlStyle: 'segmented',
    },
  },
  profileOrientation: {
    inputType: 'options',
    displayName: 'Orientation',
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
    displayName: 'Section by path segments',
    description: 'Split the sweep at each path segment.',
    dialog: {
      group: 'advanced',
      order: 0,
      controlStyle: 'segmented',
    },
  },
  tolerance: {
    displayName: 'Tolerance',
    description:
      'Leave unchanged unless the sweep needs a custom geometric tolerance.',
    dialog: {
      group: 'advanced',
      order: 10,
    },
  },
  tagStart: {
    displayName: 'Start face tag',
    dialog: {
      group: 'advanced',
      order: 20,
    },
  },
  tagEnd: {
    displayName: 'End face tag',
    dialog: {
      group: 'advanced',
      order: 30,
    },
  },
  bodyType: bodyTypeResultArg(profileSelectionRequiresBodyType),
  version: {
    displayName: 'Algorithm version',
    description:
      'Sweep algorithm version. 0 lets the engine choose; 1 is original; 2 is newer.',
    defaultValue: '2',
    dialog: {
      group: 'advanced',
      order: 40,
    },
  },
} satisfies ModelingCommandArgOverrides<SweepCommandArgs>
