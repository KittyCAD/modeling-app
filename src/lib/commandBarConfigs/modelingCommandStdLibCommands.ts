import type {
  StdLibCommandArgShape,
  StdLibCommandShape,
} from '@rust/kcl-lib/expected-bindings/ts-rs/StdLibCommandTypes'
import stdLibCommands from '@rust/kcl-lib/expected-bindings/ts-rs/StdLibCommands'

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
