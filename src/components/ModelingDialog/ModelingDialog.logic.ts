import type {
  CommandArgument,
  CommandReviewValidationDetails,
  CommandReviewValidationError,
} from '@src/lib/commandTypes'

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
