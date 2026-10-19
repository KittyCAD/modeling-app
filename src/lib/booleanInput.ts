import { createLocalName } from '@src/lang/create'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { findAllPreviousVariables, getNodeFromPath } from '@src/lang/queryAst'
import type { Program, VariableDeclaration, VariableMap } from '@src/lang/wasm'
import { isPathToNode } from '@src/lang/wasm'
import type {
  CommandArgumentOption,
  KclExpression,
} from '@src/lib/commandTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import { isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export type BooleanInputValue = boolean | KclExpression | undefined

export function booleanValueSummary(value: unknown): string {
  if (isKclCommandValue(value)) {
    const calculated = value.valueCalculated === 'true' ? 'On' : 'Off'
    return `${value.valueText} (${calculated})`
  }
  return value === undefined ? 'Use default' : value ? 'On' : 'Off'
}

export function getBooleanOptions({
  required,
  allowVariables,
  currentValue,
  ast,
  variables,
  nodeToEdit,
  wasmInstance,
}: {
  required: boolean
  allowVariables?: boolean
  currentValue: unknown
  ast: Node<Program>
  variables: VariableMap
  nodeToEdit?: unknown
  wasmInstance: ModuleType
}): CommandArgumentOption<BooleanInputValue>[] {
  const options: CommandArgumentOption<BooleanInputValue>[] = [
    ...(!required ? [{ name: 'Use default', value: undefined }] : []),
    { name: 'On', value: true },
    { name: 'Off', value: false },
  ]
  if (!allowVariables) return options

  const target = isPathToNode(nodeToEdit)
    ? getNodeFromPath<Node<VariableDeclaration>>(
        ast,
        nodeToEdit,
        wasmInstance,
        'VariableDeclaration',
        true
      )
    : undefined
  // A broken edit path must not offer variables from the end of the file.
  if (isErr(target)) return options
  const { start, end, moduleId } = target?.node ?? {
    start: ast.end,
    end: ast.end,
    moduleId: ast.moduleId,
  }
  const previous = findAllPreviousVariables(
    ast,
    variables,
    [start, end, moduleId],
    wasmInstance,
    'boolean'
  )
  for (const variable of previous.variables) {
    const value =
      isKclCommandValue(currentValue) && currentValue.valueText === variable.key
        ? currentValue
        : {
            valueAst: createLocalName(variable.key),
            valueText: variable.key,
            valueCalculated: String(variable.value),
          }
    options.push({
      name: `${variable.key} (${variable.value ? 'On' : 'Off'})`,
      value,
    })
  }
  // Preserve existing expressions as expressions when reopening an edit.
  if (
    isKclCommandValue(currentValue) &&
    !options.some((option) => option.value === currentValue)
  )
    options.push({
      name: booleanValueSummary(currentValue),
      value: currentValue,
    })
  return options
}

export async function resolveBooleanValue(
  value: unknown,
  rustContext: RustContext
): Promise<BooleanInputValue | Error> {
  if (value === undefined || typeof value === 'boolean') return value
  if (!isKclCommandValue(value)) return new Error('Select a boolean value.')
  const expression = await stringToKclExpression(value.valueText, rustContext, {
    allowBooleans: true,
  })
  if (
    isErr(expression) ||
    'errors' in expression ||
    (expression.valueCalculated !== 'true' &&
      expression.valueCalculated !== 'false')
  )
    return new Error(`${value.valueText} must evaluate to a boolean.`)
  return expression
}
