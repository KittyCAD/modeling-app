import type { ModelingCommandArgOverrides } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { ChamferCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import {
  compactSelectionDialog,
  isEditingNodeSelection,
  isUsingModelingDialog,
  modelingDialogLayout,
  type ModelingDialogContext,
} from '@src/lib/commandBarConfigs/modelingDialogShared'
import { KCL_DEFAULT_DEGREE, KCL_DEFAULT_LENGTH } from '@src/lib/constants'

export const chamferDialogLayout = modelingDialogLayout([
  {
    id: 'selection',
    title: 'Edges',
  },
  {
    id: 'size',
    title: 'Size',
  },
])

export const chamferDialogOverrides = {
  selection: {
    inputType: 'selection',
    dialog: {
      displayName: 'Edges',
      ...compactSelectionDialog('selection', 'Select edges'),
    },
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
    dialog: {
      displayName: 'Distance',
      group: 'size',
      order: 0,
    },
  },
  secondLength: {
    description: 'Distance cut from the second face.',
    defaultValue: (context: ModelingDialogContext) =>
      isUsingModelingDialog(context) ? '' : KCL_DEFAULT_LENGTH,
    dialog: {
      displayName: 'Second distance',
      group: 'size',
      order: 10,
    },
  },
  angle: {
    description: 'Greater than 0deg and less than 90deg.',
    defaultValue: (context: ModelingDialogContext) =>
      isUsingModelingDialog(context) ? '' : KCL_DEFAULT_DEGREE,
    dialog: {
      displayName: 'Angle',
      group: 'size',
      order: 20,
    },
  },
  tag: {
    dialog: {
      displayName: 'Chamfer tag',
      group: 'advanced',
      order: 0,
    },
  },
  version: {
    defaultValue: (context: ModelingDialogContext) =>
      isUsingModelingDialog(context) ? '' : '1',
    description:
      'Edge cut algorithm version. 0 lets the engine choose; 1 is original; 2 is newer.',
    dialog: {
      displayName: 'Algorithm version',
      group: 'advanced',
      order: 10,
    },
  },
} satisfies ModelingCommandArgOverrides<ChamferCommandArgs>
