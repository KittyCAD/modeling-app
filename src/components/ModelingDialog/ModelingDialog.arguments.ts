import { isOptionValueEqual } from '@kittycad/ui-components'
import {
  canSubmitDialogSelection,
  getSelectionValidationMessage,
  isSelectionArgument,
  isSelectionValueEmpty,
  selectionValueOrUndefined,
  shouldResolveDialogDefaultValue,
  type SelectionCommandArgument,
} from '@src/components/ModelingDialog/ModelingDialog.logic'
import { hasModelingDialogValue } from '@src/lib/commandBarConfigs/modelingDialogShared'
import type {
  CommandArgument,
  CommandArgumentOption,
} from '@src/lib/commandTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type { getSelectionCountByType } from '@src/lib/selections'
import { isErr } from '@src/lib/trap'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { AnyStateMachine, SnapshotFrom } from 'xstate'

export type MachineContext = SnapshotFrom<AnyStateMachine>['context']

export type KclCommandArgument = Extract<
  CommandArgument<unknown>,
  { inputType: 'kcl' }
>

export type ModelingDialogField = {
  argName: string
  arg: CommandArgument<unknown>
  isHidden: boolean
  isRequired: boolean
  isDisabled: boolean
  options: CommandArgumentOption<unknown>[]
}

export type DialogArgumentResolution =
  | { ok: true; argumentsToSubmit: Record<string, unknown> }
  | {
      ok: false
      reason:
        | 'missingCommand'
        | 'missingRequired'
        | 'invalidExpression'
        | 'invalidSelection'
      message?: string
    }

export function getKclInputValue(
  arg: KclCommandArgument,
  value: unknown
): string {
  if (isKclCommandValue(value)) {
    return arg.kclValueToInput
      ? arg.kclValueToInput(value.valueText)
      : value.valueText
  }

  return typeof value === 'string' ? value : ''
}

export function getKclSubmitValue(
  arg: KclCommandArgument,
  value: string
): string {
  const trimmedValue = value.trim()
  return arg.inputToKclValue ? arg.inputToKclValue(trimmedValue) : trimmedValue
}

function resolveContextValue(
  value: unknown,
  context: CommandBarContext
): unknown {
  return typeof value === 'function' ? value(context) : value
}

async function resolveDefaultValue(
  arg: CommandArgument<unknown>,
  context: CommandBarContext,
  wasmInstance: unknown,
  machineContext?: MachineContext
): Promise<unknown> {
  if (!('defaultValue' in arg) || arg.defaultValue === undefined) {
    return undefined
  }
  if (typeof arg.defaultValue === 'function') {
    return arg.defaultValue(context, machineContext, wasmInstance)
  }
  return arg.defaultValue
}

export function evaluateVisibility(
  argName: string,
  arg: CommandArgument<unknown>,
  context: CommandBarContext,
  machineContext?: MachineContext
): { isHidden: boolean; isRequired: boolean; isDisabled: boolean } {
  const shouldDisableSelectionInEdit =
    isSelectionArgument(arg) && Boolean(context.argumentsToSubmit.nodeToEdit)
  const shouldRevealHiddenSelectionInEdit =
    shouldDisableSelectionInEdit &&
    !isSelectionValueEmpty(context.argumentsToSubmit[argName])
  const isRawHidden =
    typeof arg.hidden === 'function'
      ? arg.hidden(context, machineContext)
      : !!arg.hidden
  const isRequired =
    typeof arg.required === 'function'
      ? arg.required(context, machineContext)
      : !!arg.required

  return {
    isHidden: isRawHidden && !shouldRevealHiddenSelectionInEdit,
    isRequired,
    isDisabled: shouldDisableSelectionInEdit,
  }
}

export function getOptions(
  arg: CommandArgument<unknown>,
  context: CommandBarContext,
  machineContext?: MachineContext
): CommandArgumentOption<unknown>[] {
  if (arg.inputType !== 'options') {
    return []
  }
  if (typeof arg.options === 'function') {
    return [...arg.options(context, machineContext)]
  }
  return [...arg.options]
}

/** Keep option values compatible with their current dependencies, including hidden fields. */
export function reconcileDialogOptions(
  context: CommandBarContext,
  values: Record<string, unknown>,
  machineContext?: MachineContext
): Record<string, unknown> {
  const normalize = context.selectedCommand?.dialogLayout?.normalizeArguments
  const argumentsToSubmit = { ...values }
  for (const [argName, arg] of Object.entries(
    context.selectedCommand?.args ?? {}
  )) {
    if (arg.inputType !== 'options') continue
    const value = argumentsToSubmit[argName]
    // Command-bar seeding can store a default function until initialization resolves it.
    if (typeof value === 'function') continue
    const currentContext = {
      ...context,
      argumentsToSubmit:
        normalize?.({ ...argumentsToSubmit }) ?? argumentsToSubmit,
    }
    const options = getOptions(arg, currentContext, machineContext)
    if (options.some((option) => isOptionValueEqual(option.value, value))) {
      continue
    }
    const hasExistingChoice =
      value !== undefined && value !== null && value !== ''
    // Repair dependent scalar choices (e.g. Export storage), but never replace
    // a chosen object such as a printer when a refreshed listing changes it.
    if (
      hasExistingChoice &&
      (typeof arg.options !== 'function' || typeof value === 'object')
    ) {
      continue
    }
    const { isRequired } = evaluateVisibility(
      argName,
      arg,
      currentContext,
      machineContext
    )
    argumentsToSubmit[argName] = shouldResolveDialogDefaultValue(
      arg,
      isRequired
    )
      ? (options.find((option) => option.isCurrent) ?? options[0])?.value
      : undefined
  }
  return argumentsToSubmit
}

/** Normalize only the presented/submitted values; retain inactive fields in the draft. */
export function reconcileDialogArguments(
  context: CommandBarContext,
  values: Record<string, unknown>,
  machineContext?: MachineContext
): Record<string, unknown> {
  const compatible = reconcileDialogOptions(context, values, machineContext)
  return (
    context.selectedCommand?.dialogLayout?.normalizeArguments?.(compatible) ??
    compatible
  )
}

/** Resolve defaults in declaration order so dependent fields see earlier values. */
export async function initializeDialogArguments(
  context: CommandBarContext,
  wasmInstance: unknown,
  machineContext?: MachineContext
): Promise<Record<string, unknown>> {
  const argumentsToSubmit = { ...context.argumentsToSubmit }
  const currentContext = { ...context, argumentsToSubmit }
  for (const [argName, arg] of Object.entries(
    context.selectedCommand?.args ?? {}
  )) {
    if (isSelectionArgument(arg)) continue
    const { isRequired } = evaluateVisibility(
      argName,
      arg,
      currentContext,
      machineContext
    )
    const existingValue = await resolveContextValue(
      argumentsToSubmit[argName],
      currentContext
    )
    const value =
      existingValue ??
      (shouldResolveDialogDefaultValue(arg, isRequired)
        ? await resolveDefaultValue(
            arg,
            currentContext,
            wasmInstance,
            machineContext
          )
        : undefined)
    argumentsToSubmit[argName] =
      arg.inputType === 'kcl'
        ? getKclInputValue(arg, value)
        : (arg.inputType === 'vector2d' || arg.inputType === 'vector3d') &&
            isKclCommandValue(value)
          ? value.valueText
          : value
  }
  return reconcileDialogOptions(context, argumentsToSubmit, machineContext)
}

export function getDraftOrSubmittedValue(
  draftValues: Record<string, unknown>,
  submittedValues: Record<string, unknown>,
  argName: string
): unknown {
  return Object.hasOwn(draftValues, argName)
    ? draftValues[argName]
    : submittedValues[argName]
}

function isMissingRequiredDialogValue(
  arg: CommandArgument<unknown>,
  value: unknown
): boolean {
  if (arg.inputType === 'options') {
    return value === undefined || value === null || value === ''
  }
  return isSelectionArgument(arg)
    ? isSelectionValueEmpty(value)
    : !hasModelingDialogValue(value)
}

export async function resolveDialogArguments({
  context,
  values,
  machineContext,
  wasmInstance,
  ast,
  rustContext,
  selectionRanges,
  activeSelectionFieldName,
  coerceSelectionForArgument,
  stopOnMissingRequired = false,
}: {
  context: CommandBarContext
  values: Record<string, unknown>
  machineContext?: MachineContext
  wasmInstance: unknown
  ast: Parameters<typeof getSelectionCountByType>[0]
  rustContext: Parameters<typeof stringToKclExpression>[1]
  selectionRanges: Selections
  activeSelectionFieldName?: string
  coerceSelectionForArgument: (
    arg: SelectionCommandArgument,
    selection: Selections | undefined
  ) => Selections | undefined | Error
  stopOnMissingRequired?: boolean
}): Promise<DialogArgumentResolution> {
  const selectedCommand = context.selectedCommand
  if (!selectedCommand?.args) {
    return { ok: false, reason: 'missingCommand' }
  }

  const normalizeArguments = (values: Record<string, unknown>) =>
    reconcileDialogArguments(context, values, machineContext)
  let argumentsToSubmit = normalizeArguments({
    ...context.argumentsToSubmit,
    ...values,
  })

  for (const [argName, arg] of Object.entries(selectedCommand.args)) {
    argumentsToSubmit = normalizeArguments(argumentsToSubmit)
    const currentContext: CommandBarContext = {
      ...context,
      argumentsToSubmit,
    }
    const { isRequired, isDisabled } = evaluateVisibility(
      argName,
      arg,
      currentContext,
      machineContext
    )
    if (isDisabled && isSelectionArgument(arg)) {
      argumentsToSubmit[argName] = selectionValueOrUndefined(
        context.argumentsToSubmit[argName]
      )
      continue
    }
    let value = isSelectionArgument(arg)
      ? argName === activeSelectionFieldName
        ? selectionRanges
        : argumentsToSubmit[argName]
      : argumentsToSubmit[argName]

    if (
      (value === undefined || value === '') &&
      shouldResolveDialogDefaultValue(arg, isRequired)
    ) {
      const defaultValue = await resolveDefaultValue(
        arg,
        currentContext,
        wasmInstance,
        machineContext
      )
      value = defaultValue
    }

    if (isSelectionArgument(arg)) {
      const rawSelection = selectionValueOrUndefined(value)
      const selection = coerceSelectionForArgument(arg, rawSelection)
      if (isErr(selection)) {
        return {
          ok: false,
          reason: 'invalidSelection',
          message: selection.message,
        }
      }
      value = selection
      if (isSelectionValueEmpty(value)) {
        value = undefined
      }

      if (!canSubmitDialogSelection(ast, arg, selection, isRequired)) {
        const message = getSelectionValidationMessage(argName, arg, selection)
        return {
          ok: false,
          reason:
            stopOnMissingRequired && !selection
              ? 'missingRequired'
              : 'invalidSelection',
          message,
        }
      }
    }

    if (arg.inputType === 'boolean' && value === '') {
      value = undefined
    } else if (
      (arg.inputType === 'string' ||
        arg.inputType === 'text' ||
        arg.inputType === 'color' ||
        arg.inputType === 'tagDeclarator') &&
      typeof value === 'string'
    ) {
      value = value.trim() === '' && !isRequired ? undefined : value
    } else if (
      arg.inputType === 'kcl' ||
      arg.inputType === 'vector2d' ||
      arg.inputType === 'vector3d'
    ) {
      if (value === undefined || value === '') {
        value = undefined
      } else if (typeof value === 'string') {
        const trimmed = value.trim()
        const expression =
          arg.inputType === 'kcl'
            ? getKclSubmitValue(arg, value)
            : arg.inputType === 'vector2d' || arg.inputType === 'vector3d'
              ? trimmed.startsWith('[')
                ? trimmed
                : `[${trimmed}]`
              : trimmed
        const parsed = await stringToKclExpression(expression, rustContext, {
          allowArrays:
            arg.inputType === 'vector2d' ||
            arg.inputType === 'vector3d' ||
            arg.allowArrays,
          allowStringArrays:
            arg.inputType === 'kcl' ? arg.allowStringArrays : undefined,
        })
        if (isErr(parsed) || 'errors' in parsed) {
          const label = arg.dialog?.displayName ?? arg.displayName ?? argName
          const message = `Invalid expression for "${label}"`
          return { ok: false, reason: 'invalidExpression', message }
        }
        value = parsed
      }
    }

    if (isRequired && isMissingRequiredDialogValue(arg, value)) {
      const label = arg.dialog?.displayName ?? arg.displayName ?? argName
      const message = `Enter "${label}".`
      return { ok: false, reason: 'missingRequired', message }
    }

    argumentsToSubmit[argName] = value
  }

  return {
    ok: true,
    argumentsToSubmit: normalizeArguments(argumentsToSubmit),
  }
}
