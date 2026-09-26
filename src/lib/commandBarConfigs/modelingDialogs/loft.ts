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
    description: 'Interpolation degree in the loft direction.',
    dialog: {
      displayName: 'Interpolation degree',
      group: 'advanced',
      order: 0,
    },
  },
  bezApproximateRational: {
    description: 'Reduce banding when lofting between arcs and non-arcs.',
    dialog: {
      displayName: 'Approximate rational curves',
      group: 'advanced',
      order: 10,
      controlStyle: 'segmented',
    },
  },
  baseCurveIndex: {
    description: 'Override the automatically chosen base profile.',
    dialog: {
      displayName: 'Base profile index',
      group: 'advanced',
      order: 20,
    },
  },
  tolerance: {
    description:
      'Leave unchanged unless the loft needs a custom geometric tolerance.',
    dialog: {
      displayName: 'Tolerance',
      group: 'advanced',
      order: 30,
    },
  },
  tagStart: {
    dialog: {
      displayName: 'Start face tag',
      group: 'advanced',
      order: 40,
    },
  },
  tagEnd: {
    dialog: {
      displayName: 'End face tag',
      group: 'advanced',
      order: 50,
    },
  },
} satisfies ModelingCommandArgOverrides<LoftCommandArgs>
