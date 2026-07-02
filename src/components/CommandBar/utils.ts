import type { CommandArgument } from '@src/lib/commandTypes'
import type { CommandBarContext } from '@src/machines/commandBarMachine'

export function evaluateCommandBarArg(
  name: string,
  arg: CommandArgument<unknown>,
  commandBarContext: CommandBarContext
) {
  const argumentsToSubmit = commandBarContext.argumentsToSubmit
  const resolvedValue =
    typeof argumentsToSubmit[name] === 'function'
      ? argumentsToSubmit[name](commandBarContext)
      : argumentsToSubmit[name]
  const value =
    resolvedValue &&
    typeof resolvedValue === 'object' &&
    'then' in resolvedValue
      ? undefined
      : resolvedValue
  const isHidden =
    typeof arg.hidden === 'function'
      ? arg.hidden(commandBarContext)
      : arg.hidden
  const isRequired =
    typeof arg.required === 'function'
      ? arg.required(commandBarContext)
      : arg.required

  return { value, isHidden, isRequired }
}
