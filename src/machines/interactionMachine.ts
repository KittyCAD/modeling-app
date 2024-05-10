import { createMachine } from 'xstate'

export type InteractionMapItem = {
  name: string
  title: string
  sequence: string
  guard: () => boolean
  action: () => void
}

export const interactionMachine = createMachine({
  context: {
    interactionMap: new Set<InteractionMapItem>(),
    prefixMatrix: new Set<Set<string>>(),
    currentSequence: [] as string[],
  },
  predictableActionArguments: true,
  preserveActionOrder: true,
  tsTypes: {} as import('./interactionMachine.typegen').Typegen0,
  schema: {
    events: {} as
      | {
          type: 'Update interaction map'
          data: InteractionMapItem[]
        }
      | { type: 'Fire event'; data: MouseEvent | KeyboardEvent }
      | { type: 'Update prefix matrix' }
      | { type: 'Add last interaction to sequence' }
      | { type: 'Clear sequence' }
      | { type: 'Resolve hotkey by prefix'; data: MouseEvent | KeyboardEvent },
  },
  id: 'Interaction Map Actor',
  initial: 'Listening for interaction',
  on: {
    'Update interaction map': {
      target: '#Interaction Map Actor',
      actions: [
        {
          type: 'Update interactionMap',
        },
        {
          type: 'Update prefix matrix',
        },
      ],
    },
  },
  description:
    'Manages the keymap of actions that can be take with the keyboard, mouse, or combination of the two while using the app.',
  states: {
    'Listening for interaction': {
      on: {
        'Fire event': {
          target: 'Resolve hotkey',
        },
      },
    },
    'Resolve hotkey': {
      invoke: {
        id: 'resolveHotkeyPrefix',
        onDone: {
          target: 'Execute keymap event',
        },
        onError: [
          {
            target: 'Listening for interaction',
            actions: {
              type: 'Add last interaction to sequence',
            },
            cond: {
              type: 'There are prefix matches',
            },
          },
          {
            target: 'Listening for interaction',
            actions: {
              type: 'Clear sequence',
            },
          },
        ],
        src: 'Resolve hotkey by prefix',
      },
    },
    'Execute keymap event': {
      exit: {
        type: 'Clear sequence',
      },
      invoke: {
        id: 'executeKeymapAction',
        onDone: {
          target: 'Listening for interaction',
        },
        onError: {
          target: 'Listening for interaction',
        },
        src: 'Execute keymap action',
      },
    },
  },
})
