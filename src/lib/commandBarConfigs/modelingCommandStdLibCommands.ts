import type {
  StdLibCommandArgShape,
  StdLibCommandShape,
} from '@rust/kcl-lib/bindings/StdLibCommandTypes'
import stdLibCommands from '@rust/kcl-lib/bindings/StdLibCommands'
import { STD_LIB_CONSTANTS } from '@rust/kcl-lib/bindings/StdLibCommands'
import type { LiteralValue } from '@rust/kcl-lib/bindings/LiteralValue'
import { capitaliseFC } from '@src/lib/utils'

export { STD_LIB_ENUMS } from '@rust/kcl-lib/bindings/StdLibCommands'

type ReadonlyStdLibCommandShape = Omit<StdLibCommandShape, 'args'> & {
  readonly args: readonly StdLibCommandArgShape[]
}

export const STD_LIB_COMMANDS = stdLibCommands satisfies Record<
  string,
  ReadonlyStdLibCommandShape
>

export type StdLibCommandName = keyof typeof STD_LIB_COMMANDS
export type StdLibCommand = (typeof STD_LIB_COMMANDS)[StdLibCommandName]
export type StdLibCommandArg = StdLibCommand['args'][number]

/** Keep the code symbol and its literal value together without duplicating KCL declarations. */
export function stdLibConstantOptions<Value extends string>(
  values: readonly Value[],
  {
    module = '',
    labels = {},
  }: {
    module?: string
    labels?: Partial<Record<Value, string>>
  } = {}
) {
  const constants: Readonly<Record<string, LiteralValue>> = STD_LIB_CONSTANTS
  return values.map((value) => ({
    name: labels[value] ?? capitaliseFC(value.toLowerCase()),
    value,
    kclValue: constants[module ? `${module}::${value}` : value],
  }))
}

export function stdLibEnumOptions<Value extends string>(
  values: readonly Value[],
  defaultValue: Value,
  labels: Partial<Record<Value, string>> = {}
) {
  return values
    .map((value) => ({
      name: labels[value] ?? value,
      value,
      isCurrent: value === defaultValue,
    }))
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent))
}
