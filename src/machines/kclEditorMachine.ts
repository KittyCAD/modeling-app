import { EditorSelection } from '@codemirror/state'
import { StateFrom, assign, createActor, setup } from 'xstate'

type SelectionEvent = {
  codeMirrorSelection: EditorSelection
  scrollIntoView: boolean
}
type KclEditorMachineEvent =
  | { type: 'setKclEditorMounted'; data: boolean }
  | { type: 'setLastSelectionEvent'; data?: SelectionEvent }

interface KclEditorMachineContext {
  isKclEditorMounted: boolean
  lastSelectionEvent?: SelectionEvent
}

/**
 * This is a one-off XState machine not tied to React, so that we can publish
 * state to it from singletons and other parts of the app.
 */
export const kclEditorMachine = setup({
  types: {
    events: {} as KclEditorMachineEvent,
    context: {} as KclEditorMachineContext,
  },
  actions: {
    setKclEditorMounted: assign({
      isKclEditorMounted: ({ context, event }) =>
        event.type === 'setKclEditorMounted'
          ? event.data
          : context.isKclEditorMounted,
    }),
    setLastSelectionEvent: assign({
      lastSelectionEvent: ({ context, event }) =>
        event.type === 'setLastSelectionEvent'
          ? event.data
          : context.lastSelectionEvent,
    }),
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QGsDGAbAohAlgFwHsAnAWQENUALHAOzAGJYw8BpDbfYkggVxr0gBtAAwBdRKAAOBWPhwEaEkAA9EARmEB2AHTCALACYAzGs0BWMwDYAHNZOWANCACeiALRrL2tQesGzamZ+FgYAnJqaAL7RTjQEEHBKaFi4hKQU1HRK0rJ48opIKupq2tZmwgZ6RpZ6msJGeqaOLupG1tq+bQFalZqWZtHRQA */
  id: 'kclEditorMachine',
  context: {
    isKclEditorMounted: false,
    lastSelectionEvent: undefined,
  },
  on: {
    setKclEditorMounted: {
      actions: 'setKclEditorMounted',
    },
    setLastSelectionEvent: {
      actions: 'setLastSelectionEvent',
    },
  },
})

export const kclEditorActor = createActor(kclEditorMachine).start()

/** Watch for changes to `lastSelectionEvent` */
export const selectionEventSelector = (
  snapshot?: StateFrom<typeof kclEditorMachine>
) => snapshot?.context?.lastSelectionEvent

/** Watch for the editorView to be mounted */
export const editorIsMountedSelector = (
  snapshot?: StateFrom<typeof kclEditorMachine>
) => snapshot?.context?.isKclEditorMounted
