import type {
  CommandArgument,
  CommandReviewValidationDetails,
  CommandReviewValidationError,
} from '@src/lib/commandTypes'
import { isArray } from '@src/lib/utils'
import type { Selections } from '@src/machines/modelingSharedTypes'

export type SelectionCommandArgument = Extract<
  CommandArgument<unknown>,
  { inputType: 'selection' | 'selectionMixed' }
>

export type ModelingDialogSelectionField = {
  argName: string
  arg: CommandArgument<unknown>
  isHidden: boolean
  isDisabled: boolean
}

export type ReviewValidationState =
  | { status: 'idle' | 'checking' | 'valid'; error?: undefined }
  | {
      status: 'invalid'
      error: string
      details?: CommandReviewValidationDetails
    }

export function isSelectionArgument(
  arg: CommandArgument<unknown>
): arg is SelectionCommandArgument {
  return arg.inputType === 'selection' || arg.inputType === 'selectionMixed'
}

export function isBodyOnlySelectionArgument(
  arg: SelectionCommandArgument
): boolean {
  return (
    arg.inputType === 'selectionMixed' &&
    arg.selectionTypes.every(
      (type) =>
        type === 'path' ||
        type === 'sweep' ||
        type === 'compositeSolid' ||
        type === 'helix'
    )
  )
}

export function shouldResolveDialogDefaultValue(
  arg: CommandArgument<unknown>,
  isRequired: boolean
): boolean {
  return (
    isRequired || !!arg.prepopulate || !!arg.skip || !!arg.dialog?.prepopulate
  )
}

export function moveSelectionInSequence(
  value: unknown,
  source: 'graphSelections' | 'otherSelections',
  selectionIndex: number,
  direction: 'up' | 'down'
): Selections | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const partialSelection = value as Partial<Selections>
  const graphSelections = isArray(partialSelection.graphSelections)
    ? partialSelection.graphSelections
    : []
  const otherSelections = isArray(partialSelection.otherSelections)
    ? partialSelection.otherSelections
    : []
  const selectionsToMove = [
    ...(source === 'graphSelections' ? graphSelections : otherSelections),
  ]
  const targetIndex = selectionIndex + (direction === 'up' ? -1 : 1)

  if (
    selectionIndex < 0 ||
    selectionIndex >= selectionsToMove.length ||
    targetIndex < 0 ||
    targetIndex >= selectionsToMove.length
  ) {
    return value as Selections
  }

  const selectionToMove = selectionsToMove[selectionIndex]
  selectionsToMove[selectionIndex] = selectionsToMove[targetIndex]
  selectionsToMove[targetIndex] = selectionToMove

  return {
    graphSelections:
      source === 'graphSelections' ? selectionsToMove : graphSelections,
    otherSelections:
      source === 'otherSelections' ? selectionsToMove : otherSelections,
  } as Selections
}

export function getActiveSelectionFieldName(
  fields: ModelingDialogSelectionField[],
  activeSelectionArgName: string | null
): string | undefined {
  if (!activeSelectionArgName) {
    return undefined
  }

  return fields.find(
    (field) =>
      field.argName === activeSelectionArgName &&
      !field.isHidden &&
      !field.isDisabled &&
      isSelectionArgument(field.arg)
  )?.argName
}

export function invalidReviewValidationState(
  error: string | CommandReviewValidationError,
  details?: CommandReviewValidationDetails
): ReviewValidationState {
  return {
    status: 'invalid',
    error: typeof error === 'string' ? error : error.message,
    details:
      details ?? (typeof error === 'string' ? undefined : error.reviewDetails),
  }
}
