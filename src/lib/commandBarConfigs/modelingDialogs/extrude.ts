import {
  getExtrudeDirectionMode,
  getExtrudeExtentType,
  normalizeExtrudeDialogArguments,
} from '@src/lib/commandBarConfigs/extrudeDialog'
import type { ModelingCommandArgOverrides } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { ExtrudeCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import {
  activeInModelingDialog,
  bodyTypeResultArg,
  compactSelectionDialog,
  hasModelingDialogValue,
  isEditingNodeSelection,
  isSelections,
  isUsingModelingDialog,
  modelingDialogLayout,
  profileSelectionRequiresBodyType,
} from '@src/lib/commandBarConfigs/modelingDialogShared'
import type { KclCommandValue } from '@src/lib/commandTypes'
import {
  KCL_DEFAULT_LENGTH,
  KCL_DEFAULT_ORIGIN_2D,
  KCL_PRELUDE_EXTRUDE_METHOD_MERGE,
  KCL_PRELUDE_EXTRUDE_METHOD_NEW,
} from '@src/lib/constants'
import { isEnginePrimitiveSelection } from '@src/lib/selections'

function isExtrudeRequirementKclCommandValue(
  value: unknown
): value is KclCommandValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'valueAst' in value &&
    'valueText' in value &&
    'valueCalculated' in value
  )
}

export function extrudeSelectionRequiresBodyType(context: {
  argumentsToSubmit: Record<string, unknown>
}): boolean {
  if (!isExtrudeRequirementKclCommandValue(context.argumentsToSubmit.length)) {
    return false
  }

  return profileSelectionRequiresBodyType(context)
}

export function extrudeSelectionRequiresMethod({
  argumentsToSubmit,
}: {
  argumentsToSubmit: Record<string, unknown>
}): boolean {
  if (!isExtrudeRequirementKclCommandValue(argumentsToSubmit.length)) {
    return false
  }

  const sketches = argumentsToSubmit.sketches
  if (!isSelections(sketches)) {
    return false
  }

  return (
    sketches.graphSelections.some(
      (selection) =>
        selection.artifact?.type === 'sweepEdge' ||
        selection.artifact?.type === 'primitiveEdge'
    ) ||
    sketches.otherSelections.some(
      (selection) =>
        isEnginePrimitiveSelection(selection) &&
        selection.primitiveType === 'edge'
    )
  )
}

export function extrudeSelectionIncludesFace({
  argumentsToSubmit,
}: {
  argumentsToSubmit: Record<string, unknown>
}): boolean {
  const sketches = argumentsToSubmit.sketches
  if (!isSelections(sketches)) {
    return false
  }

  return (
    sketches.graphSelections.some(
      (selection) =>
        selection.artifact?.type === 'cap' ||
        selection.artifact?.type === 'wall'
    ) ||
    sketches.otherSelections.some(
      (selection) =>
        isEnginePrimitiveSelection(selection) &&
        selection.primitiveType === 'face'
    )
  )
}

export function extrudeSelectionSupportsMethod(context: {
  argumentsToSubmit: Record<string, unknown>
}): boolean {
  return (
    extrudeSelectionIncludesFace(context) ||
    extrudeSelectionRequiresMethod(context)
  )
}

export const extrudeDialogLayout = modelingDialogLayout(
  [
    {
      id: 'selection',
      title: 'Profile',
    },
    {
      id: 'extent',
      title: 'Extent',
    },
    {
      id: 'result',
      title: 'Result',
    },
  ],
  normalizeExtrudeDialogArguments
)

export const extrudeDialogOverrides = {
  sketches: {
    inputType: 'selection',
    displayName: 'Profiles',
    dialog: compactSelectionDialog('selection', 'Select profiles or faces'),
    selectionTypes: [
      'solid2d',
      'segment',
      'sweepEdge',
      'primitiveEdge',
      'enginePrimitiveEdge',
      'cap',
      'wall',
      'pathRegion',
      'engineRegion',
    ],
    multiple: true,
    hidden: isEditingNodeSelection,
  },
  extentType: {
    inputType: 'options',
    displayName: 'Type',
    required: isUsingModelingDialog,
    skip: true,
    defaultValue: ({
      argumentsToSubmit,
    }: {
      argumentsToSubmit: Record<string, unknown>
    }) => getExtrudeExtentType(argumentsToSubmit),
    hidden: (context) => !isUsingModelingDialog(context),
    options: [
      { name: 'Distance', value: 'distance' },
      { name: 'To face', value: 'toFace' },
    ],
    dialog: {
      group: 'extent',
      order: -20,
      controlStyle: 'segmented',
    },
  },
  directionMode: {
    inputType: 'options',
    displayName: 'Direction',
    required: isUsingModelingDialog,
    skip: true,
    defaultValue: ({
      argumentsToSubmit,
    }: {
      argumentsToSubmit: Record<string, unknown>
    }) => getExtrudeDirectionMode(argumentsToSubmit),
    hidden: (context) =>
      !isUsingModelingDialog(context) ||
      getExtrudeExtentType(context.argumentsToSubmit) === 'toFace',
    options: [
      { name: 'One side', value: 'oneSide' },
      { name: 'Symmetric', value: 'symmetric' },
      { name: 'Two sides', value: 'twoSides' },
    ],
    dialog: {
      group: 'extent',
      order: -10,
      controlStyle: 'segmented',
    },
  },
  length: {
    ...activeInModelingDialog(
      (argumentsToSubmit) =>
        getExtrudeExtentType(argumentsToSubmit) === 'distance'
    ),
    displayName: 'Distance',
    dialog: {
      group: 'extent',
      order: 0,
    },
    defaultValue: KCL_DEFAULT_LENGTH,
    prepopulate: true,
  },
  to: {
    ...activeInModelingDialog(
      (argumentsToSubmit) =>
        getExtrudeExtentType(argumentsToSubmit) === 'toFace'
    ),
    inputType: 'selection',
    displayName: 'To face',
    dialog: compactSelectionDialog('extent', 'Select a terminating face', {
      order: 0,
    }),
    // TODO: add edgeCut during https://github.com/KittyCAD/modeling-app/issues/8831
    selectionTypes: ['cap', 'wall'],
    clearSelectionFirst: true,
    multiple: false,
    description: 'Parallel faces only.',
  },
  symmetric: {
    hidden: (context) => isUsingModelingDialog(context),
    dialog: {
      group: 'extent',
    },
  },
  bidirectionalLength: {
    ...activeInModelingDialog(
      (argumentsToSubmit) =>
        getExtrudeExtentType(argumentsToSubmit) === 'distance' &&
        getExtrudeDirectionMode(argumentsToSubmit) === 'twoSides'
    ),
    displayName: 'Second distance',
    dialog: {
      group: 'extent',
      order: 10,
    },
  },
  tagStart: {
    displayName: 'Start face tag',
    dialog: {
      group: 'advanced',
      order: 40,
    },
    // TODO: add validation like for Clone command
  },
  tagEnd: {
    displayName: 'End face tag',
    dialog: {
      group: 'advanced',
      order: 50,
    },
  },
  draftAngle: {
    displayName: 'Draft angle',
    hidden: (context) =>
      isUsingModelingDialog(context) &&
      getExtrudeExtentType(context.argumentsToSubmit) === 'toFace',
    dialog: {
      group: 'advanced',
      order: 10,
    },
  },
  twistAngle: {
    displayName: 'Twist angle',
    hidden: (context) =>
      isUsingModelingDialog(context) &&
      getExtrudeExtentType(context.argumentsToSubmit) === 'toFace',
    dialog: {
      group: 'advanced',
      order: 20,
    },
  },
  twistAngleStep: {
    displayName: 'Twist step',
    hidden: (context) =>
      isUsingModelingDialog(context) &&
      (getExtrudeExtentType(context.argumentsToSubmit) === 'toFace' ||
        !hasModelingDialogValue(context.argumentsToSubmit.twistAngle)),
    dialog: {
      group: 'advanced',
      order: 21,
    },
  },
  twistCenter: {
    displayName: 'Twist center',
    hidden: (context) =>
      isUsingModelingDialog(context) &&
      (getExtrudeExtentType(context.argumentsToSubmit) === 'toFace' ||
        !hasModelingDialogValue(context.argumentsToSubmit.twistAngle)),
    dialog: {
      group: 'advanced',
      order: 22,
    },
    defaultValue: KCL_DEFAULT_ORIGIN_2D,
  },
  direction: {
    inputType: 'selection',
    displayName: 'Direction reference',
    hidden: (context) =>
      isUsingModelingDialog(context) &&
      getExtrudeExtentType(context.argumentsToSubmit) === 'toFace',
    dialog: {
      group: 'advanced',
      order: 0,
      selectionEmptyLabel: 'Select an edge',
      compactSelection: true,
    },
    selectionTypes: [
      'segment',
      'sweepEdge',
      'primitiveEdge',
      'enginePrimitiveEdge',
    ],
    multiple: false,
    clearSelectionFirst: true,
  },
  method: {
    inputType: 'options',
    displayName: 'Operation',
    hidden: (context) =>
      isUsingModelingDialog(context) &&
      !extrudeSelectionSupportsMethod(context) &&
      !hasModelingDialogValue(context.argumentsToSubmit.method),
    dialog: {
      group: 'result',
      order: 0,
      controlStyle: 'segmented',
    },
    required: extrudeSelectionRequiresMethod,
    options: [
      {
        name: 'Merge',
        value: KCL_PRELUDE_EXTRUDE_METHOD_MERGE,
      },
      {
        name: 'New body',
        value: KCL_PRELUDE_EXTRUDE_METHOD_NEW,
      },
    ],
  },
  hideSeams: {
    displayName: 'Hide seams',
    hidden: (context) =>
      isUsingModelingDialog(context) &&
      !hasModelingDialogValue(context.argumentsToSubmit.hideSeams) &&
      (!extrudeSelectionIncludesFace(context) ||
        context.argumentsToSubmit.method === KCL_PRELUDE_EXTRUDE_METHOD_NEW),
    dialog: {
      group: 'advanced',
      order: 30,
      controlStyle: 'segmented',
    },
  },
  bodyType: bodyTypeResultArg(extrudeSelectionRequiresBodyType, { order: 10 }),
} satisfies ModelingCommandArgOverrides<ExtrudeCommandArgs>
