import type { AnyStateMachine, StateFrom } from 'xstate'

/**
 * Convert an XState state value to a pretty string,
 * with nested states separated by slashes
 */
export function xStateValueToString(
  stateValue: StateFrom<AnyStateMachine>['value']
) {
  const sep = ' / '
  let output = ''
  let remainingValues = stateValue
  let isFirstStep = true
  while (remainingValues instanceof Object) {
    const key: keyof typeof remainingValues = Object.keys(remainingValues)[0]
    output += (isFirstStep ? '' : sep) + key
    remainingValues = remainingValues[key]
    isFirstStep = false
  }
  if (typeof remainingValues === 'string' && remainingValues.trim().length) {
    return output + sep + remainingValues.trim()
  }
}
