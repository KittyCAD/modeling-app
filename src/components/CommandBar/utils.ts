import type { CommandArgument } from '@src/lib/commandTypes'

export function evaluateCommandBarArg(
  name: string,
  arg: CommandArgument<unknown>,
  context: { argumentsToSubmit: Record<string, unknown> }
) {
  const argumentsToSubmit = context.argumentsToSubmit
  const value =
    typeof argumentsToSubmit[name] === 'function'
      ? argumentsToSubmit[name](context)
      : argumentsToSubmit[name]

  return { value, ...evaluateCommandArgumentFlags(arg, context) }
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
