import type {
  CommandArgument,
  CommandArgumentOption,
} from '@src/lib/commandTypes'

/** Match the declared literal to a choice without duplicating KCL constants. */
export function getDefaultOptionIndex(
  arg: CommandArgument<unknown>,
  choices: ReadonlyArray<CommandArgumentOption<unknown>>
): number {
  const declared = arg.kclDefault
  if (arg.inputType !== 'options' || declared === undefined) return -1
  return choices.findIndex((choice) => {
    if (choice.disabled) return false
    const value = choice.kclValue ?? choice.value
    if (typeof declared !== 'object') return value === declared
    return (
      typeof value === 'object' &&
      value !== null &&
      'value' in value &&
      'suffix' in value &&
      value.value === declared.value &&
      value.suffix === declared.suffix
    )
  })
}
