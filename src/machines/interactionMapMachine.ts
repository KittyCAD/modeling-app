import { INTERACTION_MAP_SEPARATOR } from '@src/lib/constants'
import { isModifierKey, mapKey, sortKeys } from '@src/lib/keyboard'
import {
  type InteractionMapItem,
  type MouseOrKeyboardEvent,
  mouseButtonToName,
} from '@src/lib/settings/initialKeybindings'
import { platform } from '@src/lib/utils'
import toast from 'react-hot-toast'
import { assertEvent, assign, fromPromise, setup } from 'xstate'

const globalInteractionMapItems: InteractionMapItem[] = [
  {
    id: 'bring-the-pain',
    title: 'Bring the pain',
    sequence: 'g LeftButton shift+o',
    action: () => alert('BRING THE PAIN!'),
    description: "A goofy test keybinding that's always available",
    category: 'Miscellaneous',
  },
]

type InteractionMapMachineEvent =
  | {
      type: 'Add to interaction map'
      data: InteractionMapItem[]
    }
  | {
      type: 'Remove from interaction map'
      data: InteractionMapItem[]
    }
  | { type: 'Fire event'; data: MouseEvent | KeyboardEvent }
  | { type: 'Execute keymap action'; data: InteractionMapItem }
  | { type: 'Update prefix matrix' }
  | { type: 'Add last interaction to sequence' }
  | { type: 'Clear sequence' }
  | { type: 'Resolve hotkey by prefix'; data: MouseEvent | KeyboardEvent }
  | {
      type: 'Add user-defined override'
      data: { itemName: string; userDefinedSequence: string }
    }
  | {
      type: 'xstate.done.actor.resolveHotkeyByPrefix'
      output: InteractionMapItem
    }
  | {
      type: 'xstate.error.actor.resolveHotkeyByPrefix'
      error: string | undefined
    }

type InteractionMapContext = {
  interactionMap: InteractionMapItem[]
  currentSequence: string
}

export const interactionMapMachine = setup({
  types: {
    context: {} as InteractionMapContext,
    input: {} as {
      initialItems: InteractionMapItem[]
    },
    events: {} as InteractionMapMachineEvent,
  },
  actions: {
    'Add last interaction to sequence': assign({
      currentSequence: ({ event, context }) => {
        assertEvent(event, ['xstate.error.actor.resolveHotkeyByPrefix'])
        if (event.error) {
          const newSequence = context.currentSequence.concat(' ', event.error)
          console.log('newSequence', newSequence)
          return newSequence.trim()
        }

        return context.currentSequence
      },
    }),
    'Clear sequence': assign({
      currentSequence: () => {
        console.log('clearing sequence')
        return ''
      },
    }),
    'Add to interactionMap': assign({
      interactionMap: ({ context, event }) => {
        assertEvent(event, ['Add to interaction map'])
        // normalize any interaction sequences to be sorted
        const normalizedInteractions = event.data.map((item) => ({
          ...item,
          sequence: item.sequence
            .split(' ')
            .map((step) =>
              step
                .split(INTERACTION_MAP_SEPARATOR)
                .sort(sortKeys)
                .map(mapKey)
                .join(INTERACTION_MAP_SEPARATOR)
            )
            .join(' '),
        }))

        // Add the new items to the interactionMap and sort by sequence
        // making it faster to search for a sequence
        const newInteractionMap = [
          ...context.interactionMap,
          ...normalizedInteractions,
        ].sort((a, b) => a.sequence.localeCompare(b.sequence))

        console.log('newInteractionMap', newInteractionMap)
        return newInteractionMap
      },
    }),
    'Remove from interactionMap': assign({
      interactionMap: ({ context, event }) => {
        assertEvent(event, 'Remove from interaction map')

        // Filter out any matching items by name
        let newInteractionMap = [...context.interactionMap]
        for (let itemToRemove of event.data) {
          newInteractionMap = newInteractionMap.filter(
            (existingItem) =>
              existingItem.id === itemToRemove.id &&
              existingItem.category === itemToRemove.category
          )
        }
        return newInteractionMap
      },
    }),
    'Add user-defined override': assign({
      interactionMap: ({ context, event }) => {
        assertEvent(event, 'Add user-defined override')
        const foundItemIndex = context.interactionMap.findIndex(
          (item) => item.id === event.data.itemName
        )
        if (foundItemIndex >= 0) {
          const newInteractionMap = [...context.interactionMap]
          newInteractionMap[foundItemIndex] = {
            ...newInteractionMap[foundItemIndex],
            userDefinedSequence: event.data.userDefinedSequence,
          }
          return newInteractionMap
        } else {
          return context.interactionMap
        }
      },
    }),
  },
  actors: {
    'Resolve hotkey by prefix': fromPromise<
      unknown,
      {
        action: MouseOrKeyboardEvent
        interactionMap: InteractionMapItem[]
        currentSequence: InteractionMapContext['currentSequence']
      }
    >(({ input }) => {
      console.log('interaction context!', input)
      // First determine if we have a mouse or keyboard event
      const action =
        'key' in input.action
          ? mapKey(input.action.code)
          : mouseButtonToName(input.action.button)

      // if the key is already a modifier key, skip everything else and reject
      if (isModifierKey(action)) {
        // We return an empty string so that we don't clear the currentSequence
        return Promise.reject('')
      }

      const modifiers = [
        input.action.ctrlKey && 'ctrl',
        input.action.shiftKey && 'shift',
        input.action.altKey && 'alt',
        input.action.metaKey && 'meta',
      ].filter((item) => item !== false)
      const step = [action, ...modifiers]
        .sort(sortKeys)
        .join(INTERACTION_MAP_SEPARATOR)

      // Find all the sequences that start with the current sequence
      const searchString =
        (input.currentSequence ? input.currentSequence + ' ' : '') + step

      const p = platform()
      const shouldSearchForMod =
        (step.includes('meta') && p === 'macos') ||
        (step.includes('ctrl') && p !== 'macos')
      const keyToReplaceWithMod = shouldSearchForMod
        ? p === 'macos'
          ? 'meta'
          : 'ctrl'
        : null

      const matches = input.interactionMap.filter((item) => {
        if (shouldSearchForMod && keyToReplaceWithMod !== null) {
          const modReplacedSearchString = searchString.replace(
            keyToReplaceWithMod,
            'mod'
          )
          return (
            item.sequence.startsWith(searchString) ||
            item.sequence.startsWith(modReplacedSearchString)
          )
        } else {
          return item.sequence.startsWith(searchString)
        }
      })

      console.log({
        searchString,
        matches,
        step,
        shouldSearchForMod,
        keyToReplaceWithMod,
      })

      // If we have no matches, reject the promise
      if (matches.length === 0) {
        console.log('IM GONNA REJECT', matches, step)
        return Promise.reject()
      }

      const exactMatches = matches.filter((item) => {
        if (shouldSearchForMod && keyToReplaceWithMod !== null) {
          const modReplacedSearchString = searchString.replace(
            keyToReplaceWithMod,
            'mod'
          )
          return (
            item.sequence === searchString ||
            item.sequence === modReplacedSearchString
          )
        } else {
          return item.sequence == searchString
        }
      })
      if (!exactMatches.length) {
        // We have a prefix match.
        // Reject the promise and return the step
        // so we can add it to currentSequence
        return Promise.reject(step)
      }

      // Resolve to just one exact match
      const availableExactMatches = exactMatches.filter(
        (item) => !item.guard || item.guard(input.action)
      )
      if (availableExactMatches.length === 0) {
        return Promise.reject(step)
      } else {
        // return the last-added, available exact match
        return Promise.resolve(
          availableExactMatches[availableExactMatches.length - 1]
        )
      }
    }),
    'Execute keymap action': fromPromise<void, InteractionMapItem>(
      async ({ input }) => {
        try {
          console.log('Executing action', input)
          await input.action()
        } catch (error) {
          console.error(error)
          toast.error('There was an error executing the action.')
        }
      }
    ),
  },
  guards: {
    'There are prefix matches': ({ event }) => {
      assertEvent(event, 'xstate.error.actor.resolveHotkeyByPrefix')
      console.log('are there prefix matches?', event)
      return event.error !== undefined
    },
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QEkB2AXMAnAhgY3QEsB7VAAgFkcAHMgQQOKwGI6IIz1izCNt8ipMgFsaAbQAMAXUShqxWIUGpZIAB6IAzAE4AbADoATBIAcAdk0AWCQFYJmiRMMAaEAE9EAWgCMN7-t0JbRNdS0tDM29dbQBfGNc0TFwCEnIqWgYuFgAlMGFiADcwMgAzLGJhHj5k5RFxaVV5RWVVDQRow30TU29rbrsrb1cPBB8-AKDtXytg7R0TOITqgVTKGnpGLH0AGUJYTFReKFKmKqSV0mYAMUIsYrAijEkZJBAmpVTWxDmbfTMI7wmEyWYGGbThYZaUJGKw2SxwmwWSJmRYgRL8FJCdIbLL6XKwYgAGyKZAAFsR0ABrMBuZgQUhgfS8ArEan6O4E4lgAASFOpbgAQm4AAp3EqENTPRoKD6kL4IbzeTSaLreMyWXS6RWaXRmOaQhB2Aw2KyGawOEyInWo9E1VbYzJMPFwIkk8lUmnMbDlLbUQk4dAlJjCdkurm8j2CkViiVS17vFqvNreCSArq6Yw6iLaRyGGwGqK-bRzUKGbyGM0mYuGG3LTFpdaOrb413Fd38r1YH36P0BoNYEMc1sR-lC0VgcWS7wvOQyxOgZNOfxWeHRDPzMsGgFdPSObrKsxwywo+Jouu1B2bfQAUTUYDwAFdMGR+aJaA8wBg6QymagWWywDvR9MAAaRpN9MlSONZ2aT4k0QMIzH0YJvGCGYbGCVNdANTQ4X0DVUzsCswW6WJT1tC4GwyK9b3vJ9ilfdYPy-b0nV7QNg30QC6NA8CaEg0hoLeOc4IXBCQQCGxjDVawKz1eEt0tdMHDMboU20M0zBPU9UGICA4FUCj6zWaismlWC5Xg0YhncRBfH0csdRTWwTEMaIbF0TRa3OYzL1xXZ9k-I4TiwM4MXnYSLJUKz-iQwwTFwzQEvhM1bC3DTVSBTzHBNdzvPC+1GyvFsuTJPkaXM2VorEhVj1+CRdBMctLHUk03JwzR-HLHMLECDyEu8fK7SxIrcVo4CGL499HnQSqIraY9FJVUJgQ1cJUP+CRLDiOIgA */
  context: ({ input }) => ({
    interactionMap: input.initialItems ?? globalInteractionMapItems,
    currentSequence: '',
  }),
  id: 'Interaction Map Actor',
  initial: 'listening',
  description:
    'Manages the keymap of actions that can be take with the keyboard, mouse, or combination of the two while using the app.',
  states: {
    listening: {
      on: {
        'Fire event': {
          target: 'Resolve hotkey',
        },
      },
    },
    'Resolve hotkey': {
      invoke: {
        id: 'resolveHotkeyByPrefix',
        input: ({ event, context }) => {
          assertEvent(event, 'Fire event')
          return {
            action: event.data,
            interactionMap: context.interactionMap,
            currentSequence: context.currentSequence,
          }
        },
        onDone: {
          target: 'Execute keymap event',
        },
        onError: [
          {
            target: 'listening',
            actions: {
              type: 'Add last interaction to sequence',
            },
            guard: 'There are prefix matches',
          },
          {
            target: 'listening',
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
        input: ({ event }) => {
          assertEvent(event, 'xstate.done.actor.resolveHotkeyByPrefix')
          return event.output
        },
        onDone: {
          target: 'listening',
        },
        onError: {
          target: 'listening',
        },
        src: 'Execute keymap action',
      },
    },
  },
  on: {
    'Add to interaction map': {
      actions: [
        {
          type: 'Add to interactionMap',
        },
      ],
    },

    'Remove from interaction map': {
      internal: true,
      actions: [
        {
          type: 'Remove from interactionMap',
        },
      ],
    },

    'Add user-defined override': {
      actions: [{ type: 'Add user-defined override' }],
    },
  },
})
