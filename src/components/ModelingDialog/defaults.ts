import type { LiteralValue } from '@rust/kcl-lib/bindings/LiteralValue'
import type {
  CommandArgument,
  CommandArgumentOption,
} from '@src/lib/commandTypes'
import { isKclCommandValue } from '@src/lib/commandUtils'
import type { CommandBarContext } from '@src/machines/commandBarMachine'

export function getArgumentChoices(
  arg: CommandArgument<unknown>,
  context: CommandBarContext
): ReadonlyArray<CommandArgumentOption<unknown>> {
  if (arg.inputType === 'boolean') {
    return [
      { name: 'On', value: true },
      { name: 'Off', value: false },
    ]
  }
  if (arg.inputType !== 'options') return []
  return typeof arg.options === 'function'
    ? arg.options(context, arg.machineActor?.getSnapshot().context)
    : arg.options
}

function sameLiteral(value: unknown, expected: LiteralValue): boolean {
  if (typeof expected !== 'object') return value === expected
  return (
    typeof value === 'object' &&
    value !== null &&
    'value' in value &&
    'suffix' in value &&
    value.value === expected.value &&
    value.suffix === expected.suffix
  )
}

export function getDefaultOptionIndex(
  arg: CommandArgument<unknown>,
  choices: ReadonlyArray<CommandArgumentOption<unknown>>
): number {
  const declared = arg.kclDefault
  return declared === undefined
    ? -1
    : choices.findIndex(
        (choice) =>
          !choice.disabled &&
          sameLiteral(choice.kclValue ?? choice.value, declared.value)
      )
}

/** Compare literals, never an expression's calculated result or a new variable. */
export function isArgumentDefault(
  arg: CommandArgument<unknown>,
  value: unknown,
  choices: ReadonlyArray<CommandArgumentOption<unknown>> = []
): boolean {
  const declared = arg.kclDefault
  if (declared === undefined) return false
  if (value === undefined || value === '') return true
  if (isKclCommandValue(value)) {
    return (
      !('variableName' in value) &&
      value.valueAst.type === 'Literal' &&
      sameLiteral(value.valueAst.value, declared.value)
    )
  }
  switch (arg.inputType) {
    case 'options': {
      const choice = choices.find((choice) => choice.value === value)
      return (
        choice !== undefined &&
        sameLiteral(choice.kclValue ?? choice.value, declared.value)
      )
    }
    case 'kcl':
    case 'vector2d':
    case 'vector3d':
      return (
        typeof value === 'string' && value.trim() === declared.expression.trim()
      )
    case 'number':
      return (
        typeof declared.value === 'object' &&
        declared.value.suffix === 'None' &&
        (typeof value === 'number' ||
          (typeof value === 'string' &&
            /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) &&
        Number(value) === declared.value.value
      )
    case 'string':
    case 'boolean':
    case 'path':
    case 'color':
    case 'text':
      return sameLiteral(value, declared.value)
    case 'camera':
    case 'selection':
    case 'tagDeclarator':
      return false
  }
}

export function getDefaultInputText(
  arg: CommandArgument<unknown>
): string | undefined {
  const declared = arg.kclDefault
  if (declared === undefined) return undefined
  if (arg.inputType === 'kcl' && arg.kclValueToInput) {
    return arg.kclValueToInput(declared.expression)
  }
  if (
    (arg.inputType === 'string' ||
      arg.inputType === 'text' ||
      arg.inputType === 'path' ||
      arg.inputType === 'color') &&
    typeof declared.value === 'string'
  ) {
    return declared.value || declared.expression
  }
  return declared.expression
}
