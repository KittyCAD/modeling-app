// This file was automatically generated. Edits will be overwritten

export interface Typegen0 {
  '@@xstate/typegen': true
  internalEvents: {
    'xstate.init': { type: 'xstate.init' }
  }
  invokeSrcNameMap: {}
  missingImplementations: {
    actions: 'toastSuccess'
    delays: never
    guards: never
    services: never
  }
  eventsCausingActions: {
    persistSettings:
      | 'Set Base Unit'
      | 'Set Camera Controls'
      | 'Set Default Directory'
      | 'Set Default Project Name'
      | 'Set Onboarding Status'
      | 'Set Text Wrapping'
      | 'Set Theme'
      | 'Set Unit System'
      | 'Toggle Debug Panel'
    setThemeClass: 'Set Theme' | 'xstate.init'
    toastSuccess:
      | 'Set Base Unit'
      | 'Set Camera Controls'
      | 'Set Default Directory'
      | 'Set Default Project Name'
      | 'Set Text Wrapping'
      | 'Set Theme'
      | 'Set Unit System'
      | 'Toggle Debug Panel'
  }
  eventsCausingDelays: {}
  eventsCausingGuards: {}
  eventsCausingServices: {}
  matchesStates: 'idle'
  tags: never
}
