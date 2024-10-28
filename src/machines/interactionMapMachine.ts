import { INTERACTION_MAP_SEPARATOR } from 'lib/constants'
import {
  InteractionEvent,
  mapKey,
  resolveInteractionEvent,
  sortKeys,
} from 'lib/keyboard'
import { interactionMapCategories } from 'lib/settings/initialKeybindings'
import toast from 'react-hot-toast'
import { assign, ContextFrom, createMachine, fromPromise, setup } from 'xstate'

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

export type InteractionMap = {
  [key: (typeof interactionMapCategories)[number]]: Record<
    string,
    InteractionMapItem
  >
}

export type InteractionMapContext = {
  interactionMap: InteractionMap
  overrides: Record<string, string>
  currentSequence: string
}

export type InteractionMapEvents =
  | {
      type: 'Add to interaction map'
      data: {
        ownerId: string
        items: {
          [key: string]: InteractionMapItem
        }
      }
    }
  | {
      type: 'Remove from interaction map'
      data: string | string[]
    }
  | {
      type: 'Update overrides'
      data: Record<string, string>
    }
  | {
      type: 'Fire event'
      data: {
        event: KeyboardEvent | MouseEvent
      }
    }
  | {
      type: 'Add last interaction to sequence'
    }
  | {
      type: 'Clear sequence'
    }
  | {
      type: 'xstate.done.actor.resolveHotkeyByPrefix'
      output: InteractionMapItem
    }
  | {
      type: 'xstate.error.actor.resolveHotkeyByPrefix'
      error: string | undefined
    }
  | {
      type: 'xstate.done.actor.executeKeymapAction'
    }
  | {
      type: 'xstate.error.actor.executeKeymapAction'
    }

export const interactionMapMachine = setup({
  /** @xstate-layout N4IgpgJg5mDOIC5QEkB2AXMAnAhgY3QEsB7VAAgFkcAHMgQQOKwGI6IIz1izCNt8ipMgFsaAbQAMAXUShqxWIUGpZIAB6IAzAE4AbADoATBIAcAdk0AWCQFYJmiRMMAaEAE9EAWgCMN7-t0JbRNdS0tDM29dbQBfGNc0TFwCEnIqWgYuFgAlMGFiADcwMgAzLGJhHj5k5RFxaVV5RWVVDQRow30TU29rbrsrb1cPBB8-AKDtXytg7R0TOITqgVTKGnpGLH0AGUJYTFReKFKmKqSV0mYAMUIsYrAijEkZJBAmpVTWxDmbfTMI7wmEyWYGGbThYZaUJGKw2SxwmwWSJmRYgRL8FJCdIbLL6XKwYgAGyKZAAFsR0ABrMBuZgQUhgfS8ArEan6O4E4lgAASFOpbgAQm4AAp3EqENTPRoKD6kL4IbzeTSaLreMyWXS6RWaXRmOaQhB2Aw2KyGawOEyInWo9E1VbYzJMPFwIkk8lUmnMbDlLbUQk4dAlJjCdkurm8j2CkViiVS17vFqvNreCSArq6Yw6iLaRyGGwGqK-bRzUKGbyGM0mYuGG3LTFpdaOrb413Fd38r1YH36P0BoNYEMc1sR-lC0VgcWS7wvOQyxOgZNOfxWeHRDPzMsGgFdPSObrKsxwywo+Jouu1B2bfQAUTUYDwAFdMGR+aJaA8wBg6QymagWWywDvR9MAAaRpN9MlSONZ2aT4k0QMIzH0YJvGCGYbGCVNdANTQ4X0DVUzsCswW6WJT1tC4GwyK9b3vJ9ilfdYPy-b0nV7QNg30QC6NA8CaEg0hoLeOc4IXBCQQCGxjDVawKz1eEt0tdMHDMboU20M0zBPJZznrNZqKyZgAFVqAgANikKb1CAgOAhITUT1EQbUVRBA9gRsEw1SGdwvHLExkLLCR1yCzVyxPU9UGIGz4FeCi9MvLJpVguV4NGbyRl8fRyx1XCTDBQxNH+MJa10i9GyvXZ9k-I4TiwM4MXnYTkpUVL-iQwwTFwzROvhM1bC3DTVSBXQHFsHVtBsEqGvtcrcRbLkyT5GkktlFqxIVY9fiCzyzXUk1DGwnyEGVfxyxzCxAhsXROu8Ka7SxWanVo4CGL499HnQFbGraY9FJVUJgQ1cJUP+CRLDiOIgA */
  types: {
    context: {} as InteractionMapContext,
    events: {} as InteractionMapEvents,
  },
  actions: {
    'Add last interaction to sequence': assign({
      currentSequence: ({ context, event }) => {
        if (event.type !== 'xstate.error.actor.resolveHotkeyByPrefix') {
          return context.currentSequence
        }
        const newSequenceStep = event.error
        const newSequence = newSequenceStep
          ? context.currentSequence
            ? context.currentSequence.concat(' ', newSequenceStep)
            : newSequenceStep
          : context.currentSequence

        console.log('newSequence', newSequence)
        return newSequence
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
        if (event.type !== 'Add to interaction map') {
          return context.interactionMap
        }
        const newInteractions: Record<string, InteractionMapItem> =
          Object.fromEntries(
            Object.entries(event.data.items).map(([name, item]) => [
              name,
              {
                ...item,
                sequence: normalizeSequence(item.sequence),
              },
            ])
          )

        const newInteractionMap = {
          ...context.interactionMap,
          [event.data.ownerId]: {
            ...context.interactionMap[event.data.ownerId],
            ...newInteractions,
          },
        }

        // console.log('newInteractionMap', newInteractionMap)
        return newInteractionMap
      },
    }),
    'Remove from interactionMap': assign({
      interactionMap: ({ context, event }) => {
        if (event.type !== 'Remove from interaction map') {
          return context.interactionMap
        }
        const newInteractionMap = { ...context.interactionMap }
        if (event.data instanceof Array) {
          event.data.forEach((key) => {
            const [ownerId, itemName] = key.split(INTERACTION_MAP_SEPARATOR)
            delete newInteractionMap[ownerId][itemName]
          })
        } else {
          delete newInteractionMap[event.data]
        }
        return newInteractionMap
      },
    }),
    'Merge into overrides': assign({
      overrides: ({ context, event }) => {
        if (event.type !== 'Update overrides') {
          return context.overrides
        }
        return {
          ...context.overrides,
          ...event.data,
        }
      },
    }),
    'Persist keybinding overrides': ({ context }) => {
      console.log('Persisting keybinding overrides', context.overrides)
    },
  },
  actors: {
    resolveHotkeyByPrefix: fromPromise(
      ({
        input: { context, data },
      }: {
        input: { context: InteractionMapContext; data: InteractionEvent }
      }) => {
        return new Promise<InteractionMapItem>((resolve, reject) => {
          const resolvedInteraction = resolveInteractionEvent(data)

          // if the key is already a modifier key, skip everything else and reject
          if (resolvedInteraction.isModifier) {
            // We return an empty string so that we don't clear the currentSequence
            reject('')
          }

          // Find all the sequences that start with the current sequence
          const searchString =
            (context.currentSequence ? context.currentSequence + ' ' : '') +
            resolvedInteraction.asString
          const sortedInteractions = getSortedInteractionMapSequences(context)

          const matches = sortedInteractions.filter(([sequence]) =>
            sequence.startsWith(searchString)
          )

          console.log('matches', {
            matches,
            sortedInteractions,
            searchString,
            overrides: context.overrides,
          })

          // If we have no matches, reject the promise
          if (matches.length === 0) {
            reject()
          }

          const exactMatches = matches.filter(
            ([sequence]) => sequence === searchString
          )
          console.log('exactMatches', exactMatches)
          if (!exactMatches.length) {
            // We have a prefix match.
            // Reject the promise and return the step
            // so we can add it to currentSequence
            reject(resolvedInteraction.asString)
          }

          // Resolve to just one exact match
          const availableExactMatches = exactMatches.filter(
            ([_, item]) => !item.guard || item.guard(data)
          )

          console.log('availableExactMatches', availableExactMatches)
          if (availableExactMatches.length === 0) {
            reject()
          } else {
            // return the last-added, available exact match
            resolve(availableExactMatches[availableExactMatches.length - 1][1])
          }
        })
      }
    ),
    'Execute keymap action': fromPromise(
      async ({ input }: { input: InteractionMapItem }) => {
        try {
          console.log('Executing action', input)
          input.action()
        } catch (error) {
          console.error(error)
          toast.error('There was an error executing the action.')
        }
      }
    ),
  },
  guards: {
    'There are prefix matches': ({ event }) => {
      return (
        event.type === 'xstate.error.actor.resolveHotkeyByPrefix' &&
        event.error !== undefined
      )
    },
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QEkB2AXMAnAhgY3QEsB7VAAgFkcAHMgQQOKwGI6IIz1izCNt8ipMgFsaAbQAMAXUShqxWIUGpZIAB6IAHBICsAOgCcANgMBGTUc2nrAFgDMOgDQgAnogBM7g3rtGbAdjMjdx1TIzsDHQBfKOc0TFwCEnIqWgYuFgAlMGFiADcwMgAzLGJhHj5E5RFxaVV5RWVVDQR-TXc9U3d-HR1wmy6zG2c3BFM7Gz0JdyMJCM0Iu08jGLjKgWTKGnpGFgBVaggcTDJ87CxCCDhJGSQQBqVk5sRAzT0bCU0DfzmdOwlzJoRoguqsQPF+EkhKkdhk9AAZQiwTCoXhQYpMCoJDakZgAMUIWEKYAKGBu9QUj1IzwQBgcen83RC-n8NiM7IGwIQvUmZncEmM4T8tjBEKqmxh6SYemysGIABsCmQABbEdAAazALmYEFIYD0vDyxE1eiJcsVYAAEmrNS4AEIuAAKRKKhDU5LuDyadxa1jsdj0Vh6fwiwbCXJM-j07msbXcmh0rJsbNF6yhKW2UqwMrgCqVqo1WuY52l1HlxyKTGEptzFuthftTpdbo9ckp3tALQMEiMhhmOm6wRMXScrkQRlMEgZ9gkn2s3wiplT2PTWzSuxz5vzNqLJezZYrVZrW6tO8bzrArvdplubcaTx9IOmph8yYnbJ02h7pi5bI6iYcRNzH9KwbGXSFqklDcAFE1DAPAAFcTltURaBJMAMB1PUDVQI0TTAODEMwABpLVUPSZJW3udsH07RBkyjAwrG+b4BlCdxhjHbkJj0HRvhMPpIgsOxwPFaFMxgwikMKFDtnQzC9z0A90ErLBqwI+DpNIlxyPTKivVo9R6ICQxmMCVlTHYzjRhsTQoyFfw-G+PivGiMFUGIK54DuMUcQzdcMgpe9qUfBAAFofy4uxrAZX4wiWf1EtEvy11haVEWRDC0QxLAsQgwyDJCujWnpSyegBUxjAWUcbLpHw2gnTQbD6PojDctYV0giS4VlPNCgLW0gqpFRQvGMxA0nSzZiMRy-ncLk5ujdw7HaAVQnGbpktXKC4VgzTkLIuTSXQIaOyMhAAl-VkfBmWc2o+WdTBTGIoiAA */
  context: {
    interactionMap: {},
    overrides: {},
    currentSequence: '',
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
        input: ({ context, event }) => {
          if (event.type === 'Fire event') {
            return {
              context,
              data: event.data.event,
            }
          } else {
            return {
              context,
              data: {} as InteractionEvent,
            }
          }
        },
        onDone: {
          target: 'Execute keymap event',
        },
        onError: [
          {
            target: 'Listening for interaction',
            actions: {
              type: 'Add last interaction to sequence',
            },
            guard: {
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
        src: 'resolveHotkeyByPrefix',
      },
    },
    'Execute keymap event': {
      exit: {
        type: 'Clear sequence',
      },
      invoke: {
        id: 'executeKeymapAction',
        input: ({ event }) => {
          if (event.type !== 'xstate.done.actor.resolveHotkeyByPrefix') {
            return {} as InteractionMapItem
          }
          return event.output
        },
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
      reenter: false,
      actions: [
        {
          type: 'Remove from interactionMap',
        },
      ],
    },

    'Update overrides': {
      target: '#Interaction Map Actor',
      reenter: false,
      actions: ['Merge into overrides', 'Persist keybinding overrides'],
    },
  },
})

export function getSortedInteractionMapSequences(
  context: ContextFrom<typeof interactionMapMachine>
) {
  return Object.values(context.interactionMap)
    .flatMap((items) =>
      Object.entries(items).map(
        ([_, item]) =>
          [context.overrides[makeOverrideKey(item)] || item.sequence, item] as [
            string,
            InteractionMapItem
          ]
      )
    )
    .sort((a, b) => a[0].localeCompare(b[0]))
}

export function normalizeSequence(sequence: string) {
  return sequence
    .split(' ')
    .map((step) =>
      step
        .split(INTERACTION_MAP_SEPARATOR)
        .sort(sortKeys)
        .map(mapKey)
        .join(INTERACTION_MAP_SEPARATOR)
    )
    .join(' ')
}
