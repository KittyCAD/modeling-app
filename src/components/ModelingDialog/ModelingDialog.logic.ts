import type { SelectionListItem } from '@kittycad/ui-components'
import {
  canSubmitSelectionArg,
  getSelectionCountByType,
  getSelectionTypeDisplayText,
} from '@src/lib/selections'
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

export type CapturedSelectionListItem = SelectionListItem & {
  source: 'graphSelections' | 'otherSelections'
  index: number
}

export const EMPTY_SELECTION: Selections = {
  graphSelections: [],
  otherSelections: [],
}

function hasNonZeroGraphSelection(selection: Selections | undefined): boolean {
  return (
    selection?.graphSelections.some(
      (graphSelection) =>
        graphSelection.codeRef.range[1] - graphSelection.codeRef.range[0] !== 0
    ) ?? false
  )
}

export function canSubmitDialogSelection(
  ast: Parameters<typeof getSelectionCountByType>[0],
  arg: SelectionCommandArgument,
  selection: Selections | undefined,
  isRequired: boolean
): boolean {
  if (!selection) {
    return (
      !isRequired ||
      (arg.inputType === 'selectionMixed' && Boolean(arg.allowNoSelection))
    )
  }
  if (
    arg.inputType === 'selectionMixed' &&
    (!isRequired || arg.allowNoSelection)
  ) {
    return true
  }
  if (
    arg.inputType === 'selectionMixed' &&
    hasNonZeroGraphSelection(selection)
  ) {
    return true
  }
  return canSubmitSelectionArg(getSelectionCountByType(ast, selection), arg)
}

export function getSelectionValidationMessage(
  argName: string,
  arg: SelectionCommandArgument,
  selection: Selections | undefined
): string {
  const label = arg.dialog?.displayName ?? arg.displayName ?? argName
  return selection ? `Invalid selection for "${label}".` : `Select "${label}".`
}

export function removeSelectionItem(
  value: unknown,
  source: CapturedSelectionListItem['source'],
  selectionIndex: number
): Selections | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const graphSelections = isArray(
    (value as Partial<Selections>).graphSelections
  )
    ? (value as Selections).graphSelections
    : []
  const otherSelections = isArray(
    (value as Partial<Selections>).otherSelections
  )
    ? (value as Selections).otherSelections
    : []
  const nextSelection: Selections = {
    graphSelections:
      source === 'graphSelections'
        ? graphSelections.filter((_, index) => index !== selectionIndex)
        : graphSelections,
    otherSelections:
      source === 'otherSelections'
        ? otherSelections.filter((_, index) => index !== selectionIndex)
        : otherSelections,
  }

  return isSelectionValueEmpty(nextSelection) ? undefined : nextSelection
}

export function selectionValueOrUndefined(
  value: unknown
): Selections | undefined {
  return isSelectionValueEmpty(value) ? undefined : (value as Selections)
}

export function cloneSelectionValue(value: unknown): Selections | undefined {
  const selection = selectionValueOrUndefined(value)
  return selection ? structuredClone(selection) : undefined
}

export function selectionSummary(
  ast: unknown,
  selection: Selections | undefined
): string {
  if (!selection) {
    return 'No selection captured'
  }
  return getSelectionTypeDisplayText(ast as never, selection) ?? 'No selection'
}

function getSelectionItemLabel(ast: unknown, selection: Selections): string {
  const summary = selectionSummary(ast, selection).replace(/^1\s+/, '')
  return summary.charAt(0).toUpperCase() + summary.slice(1)
}

export function getSelectionListItems(
  ast: unknown,
  selection: Selections | undefined
): CapturedSelectionListItem[] {
  if (!selection) {
    return []
  }

  const items: CapturedSelectionListItem[] = []
  const identityOccurrences = new Map<string, number>()
  const itemId = (identity: unknown[]) => {
    const key = JSON.stringify(identity)
    const occurrence = identityOccurrences.get(key) ?? 0
    identityOccurrences.set(key, occurrence + 1)
    return `${key}-${occurrence}`
  }
  const canReorder =
    selection.graphSelections.length === 0 ||
    selection.otherSelections.length === 0

  selection.graphSelections.forEach((graphSelection, index) => {
    items.push({
      // Keep the row (and keyboard focus) with its geometry when reordered.
      id: itemId([
        'graph',
        graphSelection.artifact?.id ??
          graphSelection.engineEntityId ?? [
            graphSelection.codeRef.range,
            graphSelection.codeRef.pathToNode,
          ],
        graphSelection.engineEntityId,
        graphSelection.patternIndex,
      ]),
      source: 'graphSelections',
      index,
      canMoveUp: canReorder && index > 0,
      canMoveDown: canReorder && index < selection.graphSelections.length - 1,
      label: getSelectionItemLabel(ast, {
        graphSelections: [graphSelection],
        otherSelections: [],
      }),
    })
  })

  selection.otherSelections.forEach((otherSelection, index) => {
    items.push({
      id: itemId([
        'other',
        typeof otherSelection === 'string'
          ? otherSelection
          : 'entityId' in otherSelection
            ? otherSelection.entityId
            : otherSelection.id,
      ]),
      source: 'otherSelections',
      index,
      canMoveUp: canReorder && index > 0,
      canMoveDown: canReorder && index < selection.otherSelections.length - 1,
      label: getSelectionItemLabel(ast, {
        graphSelections: [],
        otherSelections: [otherSelection],
      }),
    })
  })

  return items
}
