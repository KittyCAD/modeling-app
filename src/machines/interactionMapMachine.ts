import { createMachine } from 'xstate'

export type MouseButtonName = `${'Left' | 'Middle' | 'Right'}Button`

export type InteractionMapItem = {
  name: string
  title: string
  sequence: string
  guard?: (e: MouseEvent | KeyboardEvent) => boolean
  action: () => void
  ownerId: string
}

export function makeOverrideKey(interactionMapItem: InteractionMapItem) {
  return `${interactionMapItem.ownerId}.${interactionMapItem.name}`
}

export const interactionMapMachine = createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QEkB2AXMAnAhgY3QEsB7VAAgFkcAHMgQQOKwGI6IIz1izCNt8ipMgFsaAbQAMAXUShqxWIUGpZIAB6IAzAE4AbADoATBIAcAdk0AWCQFYJmiRMMAaEAE9EAWgCMN7-t0JbRNdS0tDM29dbQBfGNc0TFwCEnIqWgYuFgAlMGFiADcwMgAzLGJhHj5k5RFxaVV5RWVVDQRow30TU29rbrsrb1cPBB8-AKDtXytg7R0TOITqgVTKGnpGLH0AGUJYTFReKFKmKqSV0mYAMUIsYrAijEkZJBAmpVTWxDmbfTMI7wmEyWYGGbThYZaUJGKw2SxwmwWSJmRYgRL8FJCdIbLL6XKwYgAGyKZAAFsR0ABrMBuZgQUhgfS8ArEan6O4E4lgAASFOpbgAQm4AAp3EqENTPRoKD6kL4IbzeTSaLreMyWXS6RWaXRmOaQhB2Aw2KyGawOEyInWo9E1VbYzJMPFwIkk8lUmnMbDlLbUQk4dAlJjCdkurm8j2CkViiVS17vFqvNreCSArq6Yw6iLaRyGGwGqK-bRzUKGbyGM0mYuGG3LTFpdaOrb413Fd38r1YH36P0BoNYEMc1sR-lC0VgcWS7wvOQyxOgZNOfxWeHRDPzMsGgFdPSObrKsxwywo+Jouu1B2bfQAUTUYDwAFdMGR+aJaA8wBg6QymagWWywDvR9MAAaRpN9MlSONZ2aT4k0QMIzH0YJvGCGYbGCVNdANTQ4X0DVUzsCswW6WJT1tC4GwyK9b3vJ9ilfdYPy-b0nV7QNg30QC6NA8CaEg0hoLeOc4IXBCQQCGxjDVawKz1eEt0tdMHDMboU20M0zBPJZznrNZqKyZgAFVqAgANikKb1CAgOAhITUT1EQbUVRBA9gRsEw1SGdwvHLExkLLCR1yCzVyxPU9UGIGz4FeCi9MvLJpVguV4NGbyRl8fRyx1XCTDBQxNH+MJa10i9GyvXZ9k-I4TiwM4MXnYTkpUVL-iQwwTFwzROvhM1bC3DTVSBXQHFsHVtBsEqGvtcrcRbLkyT5GkktlFqxIVY9fiCzyzXUk1DGwnyEGVfxyxzCxAhsXROu8Ka7SxWanVo4CGL499HnQFbGraY9FJVUJgQ1cJUP+CRLDiOIgA */
  context: {
    interactionMap: [] as InteractionMapItem[],
    overrides: {} as { [key: string]: string },
    currentSequence: '' as string,
  },
  predictableActionArguments: true,
  preserveActionOrder: true,
  tsTypes: {} as import('./interactionMapMachine.typegen').Typegen0,
  schema: {
    events: {} as
      | {
          type: 'Add to interaction map'
          data: InteractionMapItem[]
        }
      | {
          type: 'Remove from interaction map'
          data: string
        }
      | { type: 'Fire event'; data: MouseEvent | KeyboardEvent }
      | { type: 'Execute keymap action'; data: InteractionMapItem }
      | { type: 'Update prefix matrix' }
      | { type: 'Add last interaction to sequence' }
      | { type: 'Clear sequence' }
      | { type: 'Update overrides'; data: { [key: string]: string } }
      | { type: 'Resolve hotkey by prefix'; data: MouseEvent | KeyboardEvent }
      | { type: 'done.invoke.resolveHotkeyByPrefix'; data: InteractionMapItem }
      | {
          type: 'error.platform.resolveHotkeyByPrefix'
          data: string | undefined
        },
  },
  id: 'Interaction Map Actor',
  initial: 'Listening for interaction',
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
        id: 'resolveHotkeyByPrefix',
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
  on: {
    'Add to interaction map': {
      target: '#Interaction Map Actor',
      actions: [
        {
          type: 'Add to interactionMap',
        },
      ],
    },

    'Remove from interaction map': {
      target: '#Interaction Map Actor',
      internal: true,
      actions: [
        {
          type: 'Remove from interactionMap',
        },
      ],
    },

    'Update overrides': {
      target: '#Interaction Map Actor',
      internal: true,
      actions: ['Merge into overrides', 'Persist keybinding overrides'],
    },
  },
})
