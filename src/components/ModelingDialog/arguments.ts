import type { CommandArgument } from '@src/lib/commandTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import {
  canSubmitSelectionArg,
  getSelectionCountByType,
} from '@src/lib/selections'
import { isErr } from '@src/lib/trap'
import type { CommandBarContext } from '@src/machines/commandBarMachine'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { isArray } from '@src/lib/utils'

export type DialogField = {
  name: string
  arg: CommandArgument<unknown>
  required: boolean
}
export type SelectionArgument = Extract<
  CommandArgument<unknown>,
  { inputType: 'selection' }
>

export function canEditSelection(
  context: CommandBarContext,
  arg: SelectionArgument
): boolean {
  return (
    !context.argumentsToSubmit.nodeToEdit ||
    arg.dialog?.editableSelection === true
  )
}

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

export function hasValue(value: unknown): boolean {
  return isSelections(value)
    ? value.graphSelections.length + value.otherSelections.length > 0
    : value !== undefined && value !== null && value !== ''
}

export function getDialogFields(context: CommandBarContext): DialogField[] {
  return Object.entries(context.selectedCommand?.args ?? {}).flatMap(
    ([name, arg]) => {
      const machineContext = arg.machineActor?.getSnapshot().context
      const hidden =
        typeof arg.hidden === 'function'
          ? arg.hidden(context, machineContext)
          : arg.hidden
      if (hidden) return []
      const required =
        typeof arg.required === 'function'
          ? arg.required(context, machineContext)
          : arg.required
      return [{ name, arg, required }]
    }
  )
}

export async function initializeArguments(
  context: CommandBarContext
): Promise<Record<string, unknown>> {
  const values = { ...context.argumentsToSubmit }
  const wasm = await context.wasmInstancePromise
  for (const [name, arg] of Object.entries(
    context.selectedCommand?.args ?? {}
  )) {
    const current = { ...context, argumentsToSubmit: values }
    const machineContext = arg.machineActor?.getSnapshot().context
    const required =
      typeof arg.required === 'function'
        ? arg.required(current, machineContext)
        : arg.required
    let value = values[name]
    if (typeof value === 'function')
      value = await value(current, machineContext, wasm)
    if (value === undefined && (required || arg.prepopulate || arg.skip)) {
      if ('defaultValue' in arg) {
        value =
          typeof arg.defaultValue === 'function'
            ? await arg.defaultValue(current, machineContext, wasm)
            : arg.defaultValue
      }
      if (value === undefined && arg.inputType === 'options') {
        const options =
          typeof arg.options === 'function'
            ? arg.options(current, machineContext)
            : arg.options
        value = (options.find((option) => option.isCurrent) ?? options[0])
          ?.value
      }
    }
    values[name] = value
  }
  return values
}

/** Preserve hidden edit metadata and validate the visible draft before dispatch. */
export async function resolveArguments(
  context: CommandBarContext,
  values: Record<string, unknown>,
  rustContext: RustContext,
  ast: Parameters<typeof getSelectionCountByType>[0],
  artifactGraph: Parameters<typeof getSelectionCountByType>[2]
): Promise<Record<string, unknown> | Error> {
  const resolved = { ...context.argumentsToSubmit, ...values }
  for (const field of getDialogFields({
    ...context,
    argumentsToSubmit: resolved,
  })) {
    const { name, arg } = field
    const current = { ...context, argumentsToSubmit: resolved }
    const required =
      typeof arg.required === 'function'
        ? arg.required(current, arg.machineActor?.getSnapshot().context)
        : arg.required
    let value = resolved[name]
    if (arg.inputType === 'selection') {
      if (!canEditSelection(context, arg))
        value = context.argumentsToSubmit[name]
      const selection =
        isSelections(value) && hasValue(value) ? value : undefined
      if (
        (required && !selection) ||
        (selection &&
          !canSubmitSelectionArg(
            getSelectionCountByType(ast, selection, artifactGraph),
            arg
          ))
      ) {
        return new Error(`Select ${arg.displayName || name}.`)
      }
      // An explicit empty selection lets editable fields clear an authored selection.
      value =
        selection ??
        (context.argumentsToSubmit.nodeToEdit && arg.dialog?.editableSelection
          ? { graphSelections: [], otherSelections: [] }
          : undefined)
    } else if (
      (arg.inputType === 'kcl' ||
        arg.inputType === 'vector2d' ||
        arg.inputType === 'vector3d') &&
      typeof value === 'string' &&
      value.trim()
    ) {
      const expression =
        arg.inputType === 'kcl' && arg.inputToKclValue
          ? arg.inputToKclValue(value.trim())
          : value.trim()
      const parsed = await stringToKclExpression(expression, rustContext, {
        allowArrays: arg.inputType !== 'kcl' || arg.allowArrays,
        allowStringArrays:
          arg.inputType === 'kcl' ? arg.allowStringArrays : undefined,
      })
      if (isErr(parsed) || 'errors' in parsed)
        return new Error(`Invalid expression for ${arg.displayName || name}.`)
      value = parsed
    } else if (typeof value === 'string' && !value.trim()) {
      value = undefined
    }
    if (required && !hasValue(value))
      return new Error(`Enter ${arg.displayName || name}.`)
    resolved[name] = value
  }
  return resolved
}

export function fieldText(value: unknown): string {
  return isKclCommandValue(value)
    ? value.valueText
    : typeof value === 'string'
      ? value
      : ''
}
