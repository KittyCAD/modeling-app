import type { CommandArgument } from '@src/lib/commandTypes'
import type { CommandBarContext } from '@src/machines/commandBarMachine'

export function evaluateCommandBarArg(
  name: string,
  arg: CommandArgument<unknown>,
  commandBarContext: CommandBarContext
) {
  const argumentsToSubmit = commandBarContext.argumentsToSubmit
  const value =
    typeof argumentsToSubmit[name] === 'function'
      ? argumentsToSubmit[name](commandBarContext)
      : argumentsToSubmit[name]

  return { value, ...evaluateCommandArgumentFlags(arg, commandBarContext) }
}

export function evaluateCommandArgumentFlags(
  arg: CommandArgument<unknown>,
  context: { argumentsToSubmit: Record<string, unknown> }
) {
  const machineContext = arg.machineActor?.getSnapshot().context
  const isHidden =
    typeof arg.hidden === 'function'
      ? arg.hidden(context, machineContext)
      : arg.hidden
  const isRequired =
    typeof arg.required === 'function'
      ? arg.required(context, machineContext)
      : arg.required

  return { isHidden, isRequired }
}
