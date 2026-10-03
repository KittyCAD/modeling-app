import type { CommandDialogLayout } from '@src/lib/commandTypes'
import type { ModelingCommandArgOverrides } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { ExtrudeCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import {
  bodyTypeArg,
  hasCommandArgumentValue,
  isEditingNodeSelection,
  isSelections,
  isUsingModelingDialog,
  profileSelectionRequiresBodyType,
  type ModelingCommandContext,
} from '@src/lib/commandBarConfigs/modelingCommandUtils'
import { isKclCommandValue } from '@src/lib/commandUtils'
import {
  KCL_DEFAULT_LENGTH,
  KCL_DEFAULT_ORIGIN_2D,
  KCL_PRELUDE_EXTRUDE_METHOD_MERGE,
  KCL_PRELUDE_EXTRUDE_METHOD_NEW,
} from '@src/lib/constants'
import { isEnginePrimitiveSelection } from '@src/lib/selections'

export function extrudeSelectionRequiresBodyType(
  context: ModelingCommandContext
): boolean {
  if (
    !isUsingModelingDialog(context) &&
    !isKclCommandValue(context.argumentsToSubmit.length)
  ) {
    return false
  }

  return profileSelectionRequiresBodyType(context)
}

export function extrudeSelectionRequiresMethod(
  context: ModelingCommandContext
): boolean {
  const { argumentsToSubmit } = context
  if (
    !isUsingModelingDialog(context) &&
    !isKclCommandValue(argumentsToSubmit.length)
  ) {
    return false
  }

  const sketches = argumentsToSubmit.sketches
  if (!isSelections(sketches)) {
    return false
  }

  return (
    sketches.graphSelections.some(
      (selection) =>
        selection.entityRef?.type === 'edge' ||
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
        selection.entityRef?.type === 'face' ||
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

export function extrudeSelectionSupportsMethod(
  context: ModelingCommandContext
): boolean {
  return (
    extrudeSelectionIncludesFace(context) ||
    extrudeSelectionRequiresMethod(context)
  )
}

export const extrudeLayout = [
  { title: 'Profile', args: ['sketches'] },
  {
    title: 'Extent',
    args: ['length', 'to', 'symmetric', 'bidirectionalLength'],
  },
  { title: 'Result', args: ['method', 'bodyType'] },
  {
    title: 'More options',
    args: [
      'direction',
      'draftAngle',
      'twistAngle',
      'twistAngleStep',
      'twistCenter',
      'hideSeams',
      'tagStart',
      'tagEnd',
    ],
    collapsible: true,
  },
] satisfies CommandDialogLayout<keyof ExtrudeCommandArgs>

export const extrudeArgs = {
  sketches: {
    inputType: 'selection',
    displayName: 'Profiles',
    dialog: { selectionEmptyLabel: 'Select profiles or faces' },
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
  length: {
    required: (context) =>
      isUsingModelingDialog(context) &&
      !hasCommandArgumentValue(context.argumentsToSubmit.to),
    dialog: { displayName: 'Distance' },
    defaultValue: (context: ModelingCommandContext) =>
      isUsingModelingDialog(context) &&
      hasCommandArgumentValue(context.argumentsToSubmit.to)
        ? ''
        : KCL_DEFAULT_LENGTH,
    prepopulate: true,
  },
  to: {
    inputType: 'selection',
    dialog: {
      displayName: 'To face',
      selectionEmptyLabel: 'Select a terminating face',
    },
    // TODO: add edgeCut during https://github.com/KittyCAD/modeling-app/issues/8831
    selectionTypes: ['cap', 'wall'],
    clearSelectionFirst: true,
    multiple: false,
    description: 'Parallel faces only.',
  },
  bidirectionalLength: {
    dialog: { displayName: 'Second distance' },
  },
  tagStart: {
    dialog: { displayName: 'Start face tag' },
    // TODO: add validation like for Clone command
  },
  tagEnd: {
    dialog: { displayName: 'End face tag' },
  },
  draftAngle: {
    dialog: { displayName: 'Draft angle' },
  },
  twistAngle: {
    dialog: { displayName: 'Twist angle' },
  },
  twistAngleStep: {
    dialog: { displayName: 'Twist step' },
  },
  twistCenter: {
    dialog: { displayName: 'Twist center' },
    defaultValue: KCL_DEFAULT_ORIGIN_2D,
  },
  direction: {
    inputType: 'selection',
    dialog: {
      displayName: 'Direction reference',
      selectionEmptyLabel: 'Select an edge',
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
    hidden: (context) =>
      isUsingModelingDialog(context) &&
      !extrudeSelectionSupportsMethod(context) &&
      !hasCommandArgumentValue(context.argumentsToSubmit.method),
    dialog: { displayName: 'Operation', controlStyle: 'segmented' },
    required: extrudeSelectionRequiresMethod,
    options: (context) =>
      isUsingModelingDialog(context)
        ? [
            { name: 'Merge', value: KCL_PRELUDE_EXTRUDE_METHOD_MERGE },
            { name: 'New body', value: KCL_PRELUDE_EXTRUDE_METHOD_NEW },
          ]
        : [
            { name: 'New', value: KCL_PRELUDE_EXTRUDE_METHOD_NEW },
            { name: 'Merge', value: KCL_PRELUDE_EXTRUDE_METHOD_MERGE },
          ],
  },
  hideSeams: {
    hidden: (context) =>
      isUsingModelingDialog(context) &&
      !hasCommandArgumentValue(context.argumentsToSubmit.hideSeams) &&
      (!extrudeSelectionIncludesFace(context) ||
        context.argumentsToSubmit.method === KCL_PRELUDE_EXTRUDE_METHOD_NEW),
    dialog: { displayName: 'Hide seams' },
  },
  bodyType: bodyTypeArg(extrudeSelectionRequiresBodyType),
} satisfies ModelingCommandArgOverrides<ExtrudeCommandArgs>
