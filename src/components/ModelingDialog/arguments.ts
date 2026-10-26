import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  getKclInputValue,
  type CommandKclArgument,
  type CommandKclChange,
} from '@src/components/CommandBar/CommandKclInput'
import { evaluateCommandArgumentFlags } from '@src/components/CommandBar/utils'
import { coerceSelectionsForBodyOnlySelectionTypes } from '@src/lang/std/selectionCoercion'
import type { ArtifactGraph, Program } from '@src/lang/wasm'
import type { CommandArgument } from '@src/lib/commandTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import {
  canSubmitSelectionArg,
  getSelectionCountByType,
  isSelections,
} from '@src/lib/selections'
import { isErr } from '@src/lib/trap'
import type { CommandBarContext } from '@src/machines/commandBarMachine'

export type DialogField = {
  name: string
  arg: CommandArgument<unknown>
  required: boolean
}
export type SelectionArgument = Extract<
  CommandArgument<unknown>,
  { inputType: 'selection' }
>

export function hasValue(value: unknown): boolean {
  return isSelections(value)
    ? value.graphSelections.length + value.otherSelections.length > 0
    : value !== undefined && value !== null && value !== ''
}

export function updateKclArgument(
  values: Record<string, unknown>,
  name: string,
  arg: CommandKclArgument,
  change: CommandKclChange
): Record<string, unknown> {
  if (change.source === 'calculation') {
    const toExpression = (input: string) => {
      const trimmed = input.trim()
      return arg.inputToKclValue ? arg.inputToKclValue(trimmed) : trimmed
    }
    const current = toExpression(getKclInputValue(arg, values[name]))
    // Calculated values already contain the expression used by the editor.
    const calculated = isKclCommandValue(change.value)
      ? change.value.valueText
      : toExpression(change.value)
    // A calculation effect can finish after the editor has reported newer text.
    if (current !== calculated) return values
  }
  return { ...values, [name]: change.value }
}

export function getDialogFields(context: CommandBarContext): DialogField[] {
  return Object.entries(context.selectedCommand?.args ?? {}).flatMap(
    ([name, arg]) => {
      const { isHidden, isRequired } = evaluateCommandArgumentFlags(
        arg,
        context
      )
      return isHidden ? [] : [{ name, arg, required: isRequired }]
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
    const { isRequired } = evaluateCommandArgumentFlags(arg, current)
    let value = values[name]
    if (typeof value === 'function')
      value = await value(current, machineContext, wasm)
    if (value === undefined && (isRequired || arg.prepopulate || arg.skip)) {
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
  ast: Node<Program>,
  artifactGraph?: ArtifactGraph
): Promise<Record<string, unknown> | Error> {
  const resolved = { ...context.argumentsToSubmit, ...values }
  // Creation dialogs retain inactive drafts. Keep those out of the payload,
  // while preserving hidden edit arguments and static command metadata.
  if (!resolved.nodeToEdit) {
    const current = { ...context, argumentsToSubmit: resolved }
    for (const [name, arg] of Object.entries(
      context.selectedCommand?.args ?? {}
    )) {
      if (
        typeof arg.hidden === 'function' &&
        evaluateCommandArgumentFlags(arg, current).isHidden
      )
        resolved[name] = undefined
    }
  }
  for (const field of getDialogFields({
    ...context,
    argumentsToSubmit: resolved,
  })) {
    const { name, arg } = field
    const current = { ...context, argumentsToSubmit: resolved }
    // Earlier KCL arguments have now been parsed, which can change requirements.
    const { isRequired } = evaluateCommandArgumentFlags(arg, current)
    let value = resolved[name]
    if (arg.inputType === 'selection') {
      if (context.argumentsToSubmit.nodeToEdit) {
        // Edit collectors are read-only. Their original references can use
        // legacy selection types that the creation collector does not accept.
        resolved[name] = context.argumentsToSubmit[name]
        continue
      }
      let selection = isSelections(value) && hasValue(value) ? value : undefined
      if (selection && artifactGraph && !context.argumentsToSubmit.nodeToEdit) {
        selection = coerceSelectionsForBodyOnlySelectionTypes(
          selection,
          arg.selectionTypes,
          artifactGraph
        )
      }
      if (
        (isRequired && !selection) ||
        (selection &&
          !canSubmitSelectionArg(
            getSelectionCountByType(ast, selection, artifactGraph),
            arg,
            selection
          ))
      ) {
        return new Error(`Select ${arg.displayName || name}.`)
      }
      value = selection
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
    if (isRequired && !hasValue(value))
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
