import type { CommandArgument } from '@src/lib/commandTypes'
import type { CommandBarContext } from '@src/machines/commandBarMachine'

export function evaluateCommandBarArg(
  name: string,
  arg: CommandArgument<unknown>,
  commandBarContext: CommandBarContext
) {
  const argumentsToSubmit = commandBarContext.argumentsToSubmit
  const value =
    (typeof argumentsToSubmit[name] === 'function'
      ? argumentsToSubmit[name](commandBarContext)
      : argumentsToSubmit[name]) || ''
  const isHidden =
    typeof arg.hidden === 'function'
      ? arg.hidden(commandBarContext)
      : arg.hidden
  const isRequired =
    typeof arg.required === 'function'
      ? arg.required(commandBarContext)
      : arg.required
  const isPreferred =
    arg.inputType === 'kcl' && arg.preferred ? arg.preferred : false

  return { value, isHidden, isRequired, isPreferred }
}
