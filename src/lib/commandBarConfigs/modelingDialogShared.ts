import type {
  CommandArgumentDialogConfig,
  CommandDialogGroup,
  CommandDialogLayout,
} from '@src/lib/commandTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { KCL_PRELUDE_BODY_TYPE_VALUES } from '@src/lib/constants'
import { isEnginePrimitiveSelection } from '@src/lib/selections'
import { capitaliseFC, isArray } from '@src/lib/utils'
import type { Selections } from '@src/machines/modelingSharedTypes'

export type ModelingDialogContext = {
  argumentsToSubmit: Record<string, unknown>
  selectedCommand?: { useModelingDialog?: boolean }
}

export type ModelingDialogPredicate = (
  context: ModelingDialogContext
) => boolean

type DialogArguments = Readonly<Record<string, unknown>>

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

function isSelectionValueEmpty(value: unknown): boolean {
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

export function hasModelingDialogValue(value: unknown): boolean {
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

export const isEditingNode = (context: ModelingDialogContext) =>
  Boolean(context.argumentsToSubmit.nodeToEdit)

export const isEditingNodeSelection = (context: ModelingDialogContext) =>
  isEditingNode(context) && context.selectedCommand?.useModelingDialog !== true

export const isUsingModelingDialog = (context: ModelingDialogContext) =>
  context.selectedCommand?.useModelingDialog === true

export function activeInModelingDialog(
  active: (argumentsToSubmit: DialogArguments) => boolean,
  options: { requiredOutsideDialog?: boolean } = {}
) {
  return {
    required: (context: ModelingDialogContext) =>
      isUsingModelingDialog(context)
        ? active(context.argumentsToSubmit)
        : (options.requiredOutsideDialog ?? false),
    hidden: (context: ModelingDialogContext) =>
      isUsingModelingDialog(context) && !active(context.argumentsToSubmit),
  }
}

export function profileSelectionRequiresBodyType({
  argumentsToSubmit,
}: ModelingDialogContext): boolean {
  const sketches = argumentsToSubmit.sketches
  if (!isSelections(sketches)) {
    return false
  }

  const hasOpenGraphSelection = sketches.graphSelections.some(
    (selection) =>
      !selection.artifact ||
      selection.artifact.type === 'segment' ||
      selection.artifact.type === 'sweepEdge' ||
      selection.artifact.type === 'primitiveEdge'
  )

  return (
    hasOpenGraphSelection ||
    sketches.otherSelections.some(
      (selection) =>
        isEnginePrimitiveSelection(selection) &&
        selection.primitiveType === 'edge'
    )
  )
}

export function compactSelectionDialog(
  group: string,
  selectionEmptyLabel: string,
  overrides: Partial<CommandArgumentDialogConfig> = {}
): CommandArgumentDialogConfig {
  return {
    group,
    selectionEmptyLabel,
    compactSelection: true,
    hideLabel: true,
    ...overrides,
  }
}

export function modelingDialogLayout(
  groups: CommandDialogGroup[],
  normalizeArguments?: CommandDialogLayout['normalizeArguments']
): CommandDialogLayout {
  return {
    showCommandDescription: false,
    ...(normalizeArguments ? { normalizeArguments } : {}),
    groups: [
      ...groups,
      {
        id: 'advanced',
        title: 'More options',
        collapsible: true,
      },
    ],
  }
}

export function bodyTypeResultArg(
  required: ModelingDialogPredicate,
  options: { group?: string; order?: number } = {}
) {
  return {
    inputType: 'options' as const,
    required,
    options: kclBodyTypeOptions,
    dialog: {
      displayName: 'Output',
      group: options.group ?? 'result',
      order: options.order ?? 0,
      controlStyle: 'segmented' as const,
    },
  }
}
