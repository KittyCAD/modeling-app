import type { ModelingCommandArgOverrides } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { LoftCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import {
  bodyTypeResultArg,
  compactSelectionDialog,
  isEditingNodeSelection,
  modelingDialogLayout,
  profileSelectionRequiresBodyType,
} from '@src/lib/commandBarConfigs/modelingDialogShared'

export const loftDialogLayout = modelingDialogLayout([
  {
    id: 'profiles',
    title: 'Profiles',
  },
  {
    id: 'result',
    title: 'Result',
  },
])

export const loftDialogOverrides = {
  sketches: {
    inputType: 'selection',
    displayName: 'Profiles',
    description:
      'Select profiles from start to end. Their order defines the loft.',
    dialog: compactSelectionDialog('profiles', 'Select at least two profiles', {
      orderedSelection: true,
    }),
    selectionTypes: ['solid2d', 'segment', 'pathRegion', 'engineRegion'],
    multiple: true,
    hidden: isEditingNodeSelection,
  },
  bodyType: bodyTypeResultArg(profileSelectionRequiresBodyType),
  vDegree: {
    displayName: 'Interpolation degree',
    description: 'Interpolation degree in the loft direction.',
    dialog: {
      group: 'advanced',
      order: 0,
    },
  },
  bezApproximateRational: {
    displayName: 'Approximate rational curves',
    description: 'Reduce banding when lofting between arcs and non-arcs.',
    dialog: {
      group: 'advanced',
      order: 10,
      controlStyle: 'segmented',
    },
  },
  baseCurveIndex: {
    displayName: 'Base profile index',
    description: 'Override the automatically chosen base profile.',
    dialog: {
      group: 'advanced',
      order: 20,
    },
  },
  tolerance: {
    displayName: 'Tolerance',
    description:
      'Leave unchanged unless the loft needs a custom geometric tolerance.',
    dialog: {
      group: 'advanced',
      order: 30,
    },
  },
  tagStart: {
    displayName: 'Start face tag',
    dialog: {
      group: 'advanced',
      order: 40,
    },
  },
  tagEnd: {
    displayName: 'End face tag',
    dialog: {
      group: 'advanced',
      order: 50,
    },
  },
} satisfies ModelingCommandArgOverrides<LoftCommandArgs>
