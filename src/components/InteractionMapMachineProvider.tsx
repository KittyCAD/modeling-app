import { createActorContext, useMachine } from '@xstate/react'
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

export const InteractionMapMachineContext = createActorContext(
  interactionMapMachine
)

export const InteractionMapMachineProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  return (
    <InteractionMapMachineContext.Provider>
      <InteractionMapProviderInner>{children}</InteractionMapProviderInner>
    </InteractionMapMachineContext.Provider>
  )
}

function InteractionMapProviderInner({
  children,
}: {
  children: React.ReactNode
}) {
  const interactionMap = InteractionMapMachineContext.useActorRef()

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
        interactionMap.send({ type: 'Fire event', data: { event } })
      }
    }

    window.addEventListener('keydown', fireEvent)
    window.addEventListener('mousedown', fireEvent)

    return () => {
      window.removeEventListener('keydown', fireEvent)
      window.removeEventListener('mousedown', fireEvent)
    }
  }, [])

  return children
}
