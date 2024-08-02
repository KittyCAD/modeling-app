import { useMachine } from '@xstate/react'
import { INTERACTION_MAP_SEPARATOR } from 'lib/constants'
import {
  isModifierKey,
  mapKey,
  mouseButtonToName,
  resolveInteractionEvent,
  sortKeys,
} from 'lib/keyboard'
import {
  InteractionMapItem,
  MouseButtonName,
  getSortedInteractionMapSequences,
  interactionMapMachine,
  makeOverrideKey,
  normalizeSequence,
} from 'machines/interactionMapMachine'
import { createContext, useEffect } from 'react'
import toast from 'react-hot-toast'
import {
  AnyStateMachine,
  StateFrom,
  Prop,
  InterpreterFrom,
  assign,
} from 'xstate'

type MachineContext<T extends AnyStateMachine> = {
  state: StateFrom<T>
  send: Prop<InterpreterFrom<T>, 'send'>
}

export const InteractionMapMachineContext = createContext(
  {} as MachineContext<typeof interactionMapMachine>
)

export function InteractionMapMachineProvider({
  children,
}: React.PropsWithChildren<{}>) {
  const [state, send] = useMachine(interactionMapMachine, {
    logger: (msg) => {
      console.log(msg)
    },
    actions: {
      'Add last interaction to sequence': assign({
        currentSequence: (context, event) => {
          const newSequence = event.data
            ? context.currentSequence
              ? context.currentSequence.concat(' ', event.data)
              : event.data
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
        interactionMap: (context, event) => {
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
        interactionMap: (context, event) => {
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
        overrides: (context, event) => {
          return {
            ...context.overrides,
            ...event.data,
          }
        },
      }),
      'Persist keybinding overrides': (context) => {
        console.log('Persisting keybinding overrides', context.overrides)
      },
    },
    services: {
      'Resolve hotkey by prefix': (context, event) => {
        const resolvedInteraction = resolveInteractionEvent(event.data)

        // if the key is already a modifier key, skip everything else and reject
        if (resolvedInteraction.isModifier) {
          // We return an empty string so that we don't clear the currentSequence
          return Promise.reject('')
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
          return Promise.reject()
        }

        const exactMatches = matches.filter(
          ([sequence]) => sequence === searchString
        )
        console.log('exactMatches', exactMatches)
        if (!exactMatches.length) {
          // We have a prefix match.
          // Reject the promise and return the step
          // so we can add it to currentSequence
          return Promise.reject(resolvedInteraction.asString)
        }

        // Resolve to just one exact match
        const availableExactMatches = exactMatches.filter(
          ([_, item]) => !item.guard || item.guard(event.data)
        )

        console.log('availableExactMatches', availableExactMatches)
        if (availableExactMatches.length === 0) {
          return Promise.reject()
        } else {
          // return the last-added, available exact match
          return Promise.resolve(
            availableExactMatches[availableExactMatches.length - 1][1]
          )
        }
      },
      'Execute keymap action': async (_context, event) => {
        try {
          console.log('Executing action', event.data)
          event.data.action()
        } catch (error) {
          console.error(error)
          toast.error('There was an error executing the action.')
        }
      },
    },
    guards: {
      'There are prefix matches': (_context, event) => {
        return event.data !== undefined
      },
    },
  })

  // Setting up global event listeners
  useEffect(() => {
    if (!globalThis || !globalThis.window) {
      return
    }

    const fireEvent = (event: MouseEvent | KeyboardEvent) => {
      // Don't fire click events on interactable elements,
      // and make sure these fire last in the bubbling phase
      if (
        event.BUBBLING_PHASE &&
        !(
          (event.target instanceof HTMLElement &&
            ['INPUT', 'BUTTON', 'ANCHOR'].includes(event.target.tagName)) ||
          (event.target as HTMLElement).getAttribute('contenteditable') ===
            'true'
        )
      ) {
        send({ type: 'Fire event', data: event })
      }
    }

    window.addEventListener('keydown', fireEvent)
    window.addEventListener('mousedown', fireEvent)

    return () => {
      window.removeEventListener('keydown', fireEvent)
      window.removeEventListener('mousedown', fireEvent)
    }
  }, [])

  return (
    <InteractionMapMachineContext.Provider value={{ state, send }}>
      {children}
    </InteractionMapMachineContext.Provider>
  )
}
