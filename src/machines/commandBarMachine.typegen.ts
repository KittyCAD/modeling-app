// This file was automatically generated. Edits will be overwritten

export interface Typegen0 {
  '@@xstate/typegen': true
  internalEvents: {
    '': { type: '' }
    'done.invoke.validateArgument': {
      type: 'done.invoke.validateArgument'
      data: unknown
      __tip: 'See the XState TS docs to learn how to strongly type this.'
    }
    'done.invoke.validateArguments': {
      type: 'done.invoke.validateArguments'
      data: unknown
      __tip: 'See the XState TS docs to learn how to strongly type this.'
    }
    'error.platform.validateArgument': {
      type: 'error.platform.validateArgument'
      data: unknown
    }
    'error.platform.validateArguments': {
      type: 'error.platform.validateArguments'
      data: unknown
    }
    'xstate.init': { type: 'xstate.init' }
  }
  invokeSrcNameMap: {
    'Validate all arguments': 'done.invoke.validateArguments'
    'Validate argument': 'done.invoke.validateArgument'
  }
  missingImplementations: {
    actions:
      | 'Add arguments'
      | 'Close dialog'
      | 'Execute command'
      | 'Open dialog'
    delays: never
    guards: never
    services: never
  }
  eventsCausingActions: {
    'Add arguments': 'done.invoke.validateArguments'
    'Add commands': 'Add commands'
    'Close dialog': 'Close'
    'Execute command': '' | 'Submit'
    'Open dialog': 'Open'
    'Remove argument': 'Remove argument'
    'Remove commands': 'Remove commands'
    'Set current argument':
      | 'Add argument'
      | 'Edit argument'
      | 'error.platform.validateArguments'
  }
  eventsCausingDelays: {}
  eventsCausingGuards: {
    'Arguments are ready': 'done.invoke.validateArguments'
    'Command has no arguments': ''
  }
  eventsCausingServices: {
    'Validate all arguments': 'done.invoke.validateArgument'
    'Validate argument': 'Submit'
  }
  matchesStates:
    | 'Checking Arguments'
    | 'Closed'
    | 'Command selected'
    | 'Gathering arguments'
    | 'Gathering arguments.Awaiting input'
    | 'Gathering arguments.Validating'
    | 'Review'
    | 'Selecting command'
    | { 'Gathering arguments'?: 'Awaiting input' | 'Validating' }
  tags: never
}
