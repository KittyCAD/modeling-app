import { modelingStdLibCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type {
  ExtrudeCommandArgs,
  LoftCommandArgs,
} from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'
import {
  KCL_DEFAULT_LENGTH,
  KCL_DEFAULT_ORIGIN_2D,
  KCL_PRELUDE_BODY_TYPE_VALUES,
  KCL_PRELUDE_EXTRUDE_METHOD_VALUES,
} from '@src/lib/constants'
import { isEnginePrimitiveSelection, isSelections } from '@src/lib/selections'
import { capitaliseFC } from '@src/lib/utils'
export const kclBodyTypeOptions = KCL_PRELUDE_BODY_TYPE_VALUES.map((value) => ({
  name: capitaliseFC(value.toLowerCase()),
  value,
}))

export function profileSelectionRequiresBodyType({
  argumentsToSubmit,
}: {
  argumentsToSubmit: Record<string, unknown>
}): boolean {
  const sketches = argumentsToSubmit.sketches
  if (!isSelections(sketches)) return false

  const hasOpenGraphSelection = sketches.graphSelections.some((selection) => {
    // Face API selections may intentionally omit the legacy artifact. Use
    // their entity reference so a closed region is not treated as an edge.
    if (selection.entityRef) {
      return (
        selection.entityRef.type === 'segment' ||
        selection.entityRef.type === 'solid2d_edge' ||
        selection.entityRef.type === 'edge'
      )
    }

    return (
      !selection.artifact ||
      selection.artifact.type === 'segment' ||
      selection.artifact.type === 'sweepEdge' ||
      selection.artifact.type === 'primitiveEdge'
    )
  })

  return (
    hasOpenGraphSelection ||
    sketches.otherSelections.some(
      (selection) =>
        isEnginePrimitiveSelection(selection) &&
        selection.primitiveType === 'edge'
    )
  )
}

export function extrudeSelectionRequiresBodyType(context: {
  argumentsToSubmit: Record<string, unknown>
}): boolean {
  if (!isKclCommandValue(context.argumentsToSubmit.length)) {
    return false
  }

  return profileSelectionRequiresBodyType(context)
}

export function extrudeSelectionRequiresMethod({
  argumentsToSubmit,
}: {
  argumentsToSubmit: Record<string, unknown>
}): boolean {
  if (!isKclCommandValue(argumentsToSubmit.length)) {
    return false
  }

  const sketches = argumentsToSubmit.sketches
  if (!isSelections(sketches)) return false

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

export const isEditingNode = (context: {
  argumentsToSubmit: Record<string, unknown>
}) => Boolean(context.argumentsToSubmit.nodeToEdit)

export const isEditingNodeSelection = (context: {
  argumentsToSubmit: Record<string, unknown>
  selectedCommand?: { useModelingDialog?: boolean }
}) =>
  isEditingNode(context) && context.selectedCommand?.useModelingDialog !== true

/** Legacy command definitions reuse the same stdlib argument generation after their profile-specific overrides are extracted. */
export const extrudeCommandConfig = {
  icon: 'extrude',
  needsReview: true,
  args: modelingStdLibCommandArgs<ExtrudeCommandArgs>('Extrude', {
    overrides: {
      sketches: {
        inputType: 'selection',
        displayName: 'Profiles',
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
        defaultValue: KCL_DEFAULT_LENGTH,
        prepopulate: true,
      },
      to: {
        inputType: 'selection',
        // TODO: add edgeCut during https://github.com/KittyCAD/modeling-app/issues/8831
        selectionTypes: ['cap', 'wall'],
        clearSelectionFirst: true,
        multiple: false,
        description: 'Only parallel faces are supported for now.',
        hidden: isEditingNodeSelection,
      },
      tagStart: {
        dialog: { advanced: true },
        // TODO: add validation like for Clone command
      },
      twistCenter: {
        dialog: { advanced: true },
        defaultValue: KCL_DEFAULT_ORIGIN_2D,
      },
      direction: {
        dialog: { advanced: true },
        inputType: 'selection',
        selectionTypes: [
          'segment',
          'sweepEdge',
          'primitiveEdge',
          'enginePrimitiveEdge',
        ],
        multiple: false,
        clearSelectionFirst: true,
        hidden: isEditingNodeSelection,
      },
      tagEnd: { dialog: { advanced: true } },
      draftAngle: { dialog: { advanced: true } },
      twistAngle: { dialog: { advanced: true } },
      twistAngleStep: { dialog: { advanced: true } },
      hideSeams: { dialog: { advanced: true } },
      method: {
        inputType: 'options',
        required: extrudeSelectionRequiresMethod,
        options: KCL_PRELUDE_EXTRUDE_METHOD_VALUES.map((value) => ({
          name: capitaliseFC(value.toLowerCase()),
          value,
        })),
      },
      bodyType: {
        inputType: 'options',
        required: extrudeSelectionRequiresBodyType,
        options: kclBodyTypeOptions,
      },
    },
  }),
} as const

export const loftCommandConfig = {
  icon: 'loft',
  needsReview: true,
  args: modelingStdLibCommandArgs<LoftCommandArgs>('Loft', {
    overrides: {
      sketches: {
        inputType: 'selection',
        displayName: 'Profiles',
        selectionTypes: ['solid2d', 'segment', 'pathRegion', 'engineRegion'],
        multiple: true,
        hidden: isEditingNodeSelection,
      },
      bodyType: {
        inputType: 'options',
        required: profileSelectionRequiresBodyType,
        options: kclBodyTypeOptions,
      },
      vDegree: { dialog: { advanced: true } },
      bezApproximateRational: { dialog: { advanced: true } },
      baseCurveIndex: { dialog: { advanced: true } },
      tolerance: { dialog: { advanced: true } },
      tagStart: { dialog: { advanced: true } },
      tagEnd: { dialog: { advanced: true } },
    },
  }),
} as const
