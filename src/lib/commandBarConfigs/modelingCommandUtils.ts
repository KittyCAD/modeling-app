import { isKclCommandValue } from '@src/lib/commandUtils'
import { KCL_PRELUDE_BODY_TYPE_VALUES } from '@src/lib/constants'
import { isEnginePrimitiveSelection } from '@src/lib/selections'
import { capitaliseFC, isArray } from '@src/lib/utils'
import type { Selections } from '@src/machines/modelingSharedTypes'

export type ModelingCommandContext = {
  argumentsToSubmit: Record<string, unknown>
  selectedCommand?: { useModelingDialog?: boolean }
}

export type ModelingCommandPredicate = (
  context: ModelingCommandContext
) => boolean

const kclBodyTypeOptions = KCL_PRELUDE_BODY_TYPE_VALUES.map((value) => ({
  name: capitaliseFC(value.toLowerCase()),
  value,
}))

export function isSelections(value: unknown): value is Selections {
  return (
    typeof value === 'object' &&
    value !== null &&
    'graphSelections' in value &&
    isArray(value.graphSelections) &&
    'otherSelections' in value &&
    isArray(value.otherSelections)
  )
}

export function isSelectionValueEmpty(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return true
  }

  const selection = value as Partial<Selections>
  const graphSelections = isArray(selection.graphSelections)
    ? selection.graphSelections
    : []
  const otherSelections = isArray(selection.otherSelections)
    ? selection.otherSelections
    : []

  return graphSelections.length === 0 && otherSelections.length === 0
}

export function hasCommandArgumentValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') {
    return false
  }
  if (typeof value === 'boolean') {
    return true
  }
  if (isArray(value)) {
    return value.length > 0
  }
  if (typeof value === 'object') {
    return isKclCommandValue(value) || !isSelectionValueEmpty(value)
  }
  return true
}

export const isEditingNode = (context: ModelingCommandContext) =>
  Boolean(context.argumentsToSubmit.nodeToEdit)

export const isEditingNodeSelection = (context: ModelingCommandContext) =>
  isEditingNode(context) && context.selectedCommand?.useModelingDialog !== true

export const isUsingModelingDialog = (context: ModelingCommandContext) =>
  context.selectedCommand?.useModelingDialog === true

export function profileSelectionRequiresBodyType({
  argumentsToSubmit,
}: ModelingCommandContext): boolean {
  const sketches = argumentsToSubmit.sketches
  if (!isSelections(sketches)) {
    return false
  }

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

export function bodyTypeArg(required: ModelingCommandPredicate) {
  return {
    inputType: 'options' as const,
    required,
    options: kclBodyTypeOptions,
    dialog: {
      displayName: 'Output',
      controlStyle: 'segmented' as const,
    },
  }
}
