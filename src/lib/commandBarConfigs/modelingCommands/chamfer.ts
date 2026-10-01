import type { CommandDialogLayout } from '@src/lib/commandTypes'
import type { ModelingCommandArgOverrides } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { ChamferCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import { isEditingNodeSelection } from '@src/lib/commandBarConfigs/modelingCommandUtils'
import { KCL_DEFAULT_DEGREE, KCL_DEFAULT_LENGTH } from '@src/lib/constants'

export const chamferLayout = [
  { title: 'Edges', args: ['selection'] },
  { title: 'Size', args: ['length', 'secondLength', 'angle'] },
  { title: 'More options', args: ['tag', 'version'], collapsible: true },
] satisfies CommandDialogLayout<keyof ChamferCommandArgs>

export const chamferArgs = {
  selection: {
    inputType: 'selection',
    dialog: { displayName: 'Edges' },
    selectionTypes: [
      'segment',
      'sweepEdge',
      'primitiveEdge',
      'enginePrimitiveEdge',
    ],
    multiple: true,
    required: true,
    hidden: isEditingNodeSelection,
  },
  length: {
    description: 'Primary chamfer distance.',
    defaultValue: KCL_DEFAULT_LENGTH,
    dialog: { displayName: 'Distance' },
  },
  secondLength: {
    description: 'Distance cut from the second face.',
    defaultValue: KCL_DEFAULT_LENGTH,
    dialog: { displayName: 'Second distance' },
  },
  angle: {
    description: 'Greater than 0deg and less than 90deg.',
    defaultValue: KCL_DEFAULT_DEGREE,
  },
  tag: {
    dialog: { displayName: 'Chamfer tag' },
  },
  version: {
    defaultValue: '1',
    description:
      'Edge cut algorithm version. 0 lets the engine choose; 1 is original; 2 is newer.',
    dialog: { displayName: 'Algorithm version' },
  },
} satisfies ModelingCommandArgOverrides<ChamferCommandArgs>
