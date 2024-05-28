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
  MouseButtonName,
  interactionMapMachine,
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
        interactionMap: (context, event) => {
          // Filter out any items that have an ownerId that matches event.data
          return [
            ...context.interactionMap.filter(
              (item) => item.ownerId !== event.data
            ),
          ]
        },
      }),
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

        const matches = context.interactionMap.filter((item) =>
          item.sequence.startsWith(searchString)
        )

        console.log('matches', {
          matches,
          interactionMap: context.interactionMap,
          searchString,
        })

        // If we have no matches, reject the promise
        if (matches.length === 0) {
          return Promise.reject()
        }

        const exactMatches = matches.filter(
          (item) => item.sequence === searchString
        )
        if (!exactMatches.length) {
          // We have a prefix match.
          // Reject the promise and return the step
          // so we can add it to currentSequence
          return Promise.reject(resolvedInteraction.asString)
        }

        // Resolve to just one exact match
        const availableExactMatches = exactMatches.filter((item) =>
          item.guard(event.data)
        )
        if (availableExactMatches.length === 0) {
          return Promise.reject()
        } else {
          // return the last-added, available exact match
          return Promise.resolve(
            availableExactMatches[availableExactMatches.length - 1]
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
