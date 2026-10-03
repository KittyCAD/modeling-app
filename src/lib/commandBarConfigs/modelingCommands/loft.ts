import type { CommandDialogLayout } from '@src/lib/commandTypes'
import type { ModelingCommandArgOverrides } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { LoftCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import {
  bodyTypeArg,
  isEditingNodeSelection,
  profileSelectionRequiresBodyType,
} from '@src/lib/commandBarConfigs/modelingCommandUtils'

export const loftLayout = [
  { title: 'Profiles', args: ['sketches'] },
  { title: 'Result', args: ['bodyType'] },
  {
    title: 'More options',
    args: [
      'vDegree',
      'bezApproximateRational',
      'baseCurveIndex',
      'tolerance',
      'tagStart',
      'tagEnd',
    ],
    collapsible: true,
  },
] satisfies CommandDialogLayout<keyof LoftCommandArgs>

export const loftArgs = {
  sketches: {
    inputType: 'selection',
    displayName: 'Profiles',
    description:
      'Select profiles from start to end. Their order defines the loft.',
    ordered: true,
    dialog: { selectionEmptyLabel: 'Select at least two profiles' },
    selectionTypes: ['solid2d', 'segment', 'pathRegion', 'engineRegion'],
    multiple: true,
    hidden: isEditingNodeSelection,
  },
  bodyType: bodyTypeArg(profileSelectionRequiresBodyType),
  vDegree: {
    description: 'Interpolation degree in the loft direction.',
    dialog: { displayName: 'Interpolation degree' },
  },
  bezApproximateRational: {
    description: 'Reduce banding when lofting between arcs and non-arcs.',
    dialog: { displayName: 'Approximate rational curves' },
  },
  baseCurveIndex: {
    description: 'Override the automatically chosen base profile.',
    dialog: { displayName: 'Base profile index' },
  },
  tolerance: {
    description:
      'Leave unchanged unless the loft needs a custom geometric tolerance.',
  },
  tagStart: {
    dialog: { displayName: 'Start face tag' },
  },
  tagEnd: {
    dialog: { displayName: 'End face tag' },
  },
} satisfies ModelingCommandArgOverrides<LoftCommandArgs>
