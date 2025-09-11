import { interactionMapActor } from '@src/lib/singletons'
import type { PropsWithChildren } from 'react'
import { useEffect } from 'react'

export const InteractionListener = ({ children }: PropsWithChildren) => {
  // Setting up global event listeners
  useEffect(() => {
    if (!globalThis || !globalThis.window) {
      return
    }

    const fireEvent = (event: MouseEvent | KeyboardEvent) => {
      interactionMapActor.send({ type: 'Fire event', data: event })
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
