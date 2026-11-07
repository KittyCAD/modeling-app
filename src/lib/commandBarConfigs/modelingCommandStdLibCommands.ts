import type {
  StdLibCommandArgShape,
  StdLibCommandShape,
} from '@rust/kcl-lib/bindings/StdLibCommandTypes'
import stdLibCommands from '@rust/kcl-lib/bindings/StdLibCommands'

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
